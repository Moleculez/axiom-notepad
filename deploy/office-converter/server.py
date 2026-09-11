"""Private, bounded Office-to-PDF conversion. No database or storage credentials."""
import hmac
import io
import os
from pathlib import Path
import resource
import subprocess
import tempfile
import zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer

MAX_BYTES = 50_000_000

def restrict_process():
    resource.setrlimit(resource.RLIMIT_CPU, (60, 60))
    resource.setrlimit(resource.RLIMIT_FSIZE, (100_000_000, 100_000_000))
    resource.setrlimit(resource.RLIMIT_NOFILE, (512, 512))
    os.umask(0o077)

def validate_archive(data, kind):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if len(entries) > 20000 or sum(e.file_size for e in entries) > 200_000_000:
            raise ValueError("Archive exceeds safe expansion limits")
        names = set()
        for entry in entries:
            name = entry.filename
            if entry.flag_bits & 1 or name.startswith("/") or ".." in name.split("/") or "\\" in name:
                raise ValueError("Unsafe or encrypted archive")
            if entry.file_size > 1_000_000 and entry.file_size / max(1, entry.compress_size) > 300:
                raise ValueError("Archive compression ratio exceeds limit")
            if "vbaproject" in name.lower() or "/embeddings/" in name.lower():
                raise ValueError("Macros and embedded executable objects are not previewed")
            names.add(name)
        root = "word/document.xml" if kind == "docx" else "ppt/presentation.xml"
        if "[Content_Types].xml" not in names or root not in names:
            raise ValueError("Unsupported Office archive")

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Do not log filenames, source data, authentication or request bodies.

    def respond(self, code, body, mime="text/plain"):
        self.send_response(code)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.respond(200 if self.path == "/health" else 404, b"private-converter")

    def do_POST(self):
        token = os.environ.get("OFFICE_CONVERTER_TOKEN", "")
        if not token or not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token):
            self.respond(403, b"Forbidden")
            return
        kind = self.headers.get("X-File-Kind", "")
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if self.path != "/convert" or kind not in ("docx", "pptx") or not 0 < length <= MAX_BYTES:
                raise ValueError("Unsupported conversion request")
            data = self.rfile.read(length)
            if len(data) != length:
                raise ValueError("Incomplete request")
            validate_archive(data, kind)
            with tempfile.TemporaryDirectory(prefix="axiom-office-", dir="/tmp") as tmp:
                directory = Path(tmp)
                source = directory / ("input." + kind)
                source.write_bytes(data)
                profile = directory / "profile"
                (profile / "user").mkdir(parents=True)
                (profile / "user" / "registrymodifications.xcu").write_text('''<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Common/Load"><prop oor:name="UpdateMode" oor:op="fuse"><value>0</value></prop></item></oor:items>''', encoding="utf-8")
                subprocess.run(["/usr/bin/soffice", "-env:UserInstallation=" + profile.as_uri(), "--headless", "--nologo", "--nodefault", "--norestore", "--nolockcheck", "--convert-to", "pdf", "--outdir", tmp, str(source)],
                               check=True, timeout=75, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               cwd=tmp, env={"HOME": tmp, "TMPDIR": tmp, "PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"}, preexec_fn=restrict_process)
                output = directory / "input.pdf"
                if not output.is_file() or output.stat().st_size > 80_000_000:
                    raise ValueError("Conversion did not produce a bounded PDF")
                result = output.read_bytes()
                if not result.startswith(b"%PDF-"):
                    raise ValueError("Invalid conversion output")
                self.respond(200, result, "application/pdf")
        except (ValueError, OSError, zipfile.BadZipFile, subprocess.SubprocessError):
            self.respond(422, b"This document could not be converted safely. The original is unchanged.")

HTTPServer(("0.0.0.0", 8090), Handler).serve_forever()
