"""Authenticated internal-only OCR gateway. Never expose this port publicly."""
import hmac
import json
import os
from pathlib import Path
import select
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ.get("PDF_OCR_TOKEN", "")
MAX_INPUT = 100 * 1024 * 1024
MAX_OUTPUT = 200 * 1024 * 1024
SLOT = threading.BoundedSemaphore(1)


def options(headers):
    mode = headers.get("x-ocr-mode", "")
    if mode not in ("text", "pdf", "research"):
        raise ValueError("Unsupported mode")
    if mode == "research" and os.environ.get("PDF_RESEARCH_OCR") != "1":
        raise ValueError("Research OCR is disabled")
    language = headers.get("x-ocr-language", "eng")
    if language not in ("eng", "chi_sim", "eng+chi_sim", "deu", "fra", "spa"):
        raise ValueError("Unsupported language")
    if mode == "research" and language not in ("eng", "chi_sim", "eng+chi_sim"):
        raise ValueError("Equation-aware OCR supports English and Simplified Chinese")
    pages = headers.get("x-ocr-pages", "").split(",")
    if not pages or len(pages) > 2000 or any(not p.isdecimal() or not 1 <= int(p) <= 2000 for p in pages):
        raise ValueError("Invalid page selection")
    if len(set(pages)) != len(pages) or (mode != "pdf" and len(pages) != 1):
        raise ValueError("Invalid page selection")
    return {"mode": mode, "language": language, "pages": [int(p) for p in pages]}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass  # Never log PDF contents, authorization, or filenames.

    def reply(self, status, body, content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.reply(200 if self.path == "/health" else 404, b'{"ready":true}')

    def do_POST(self):
        if self.path != "/process":
            return self.reply(404, b'{}')
        if not TOKEN or not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + TOKEN):
            return self.reply(401, b'{}')
        if not SLOT.acquire(blocking=False):
            return self.reply(429, b'{"error":"OCR is busy"}')
        proc = None
        try:
            self.connection.settimeout(30)
            config = options(self.headers)
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= MAX_INPUT:
                return self.reply(413, b'{}')
            with tempfile.TemporaryDirectory(prefix="axiom-ocr-") as directory:
                root = Path(directory)
                with (root / "source.pdf").open("wb") as output:
                    remaining = size
                    while remaining:
                        chunk = self.rfile.read(min(remaining, 1024 * 1024))
                        if not chunk:
                            raise ValueError("Interrupted upload")
                        output.write(chunk)
                        remaining -= len(chunk)
                (root / "settings.json").write_text(json.dumps(config))
                with (root / "process.log").open("wb") as log:
                    proc = subprocess.Popen([sys.executable, str(Path(__file__).with_name("process.py")), directory], stdout=log, stderr=log, start_new_session=True)
                    deadline = time.monotonic() + (3600 if config["mode"] == "pdf" else 290)
                    while proc.poll() is None:
                        if time.monotonic() > deadline:
                            raise TimeoutError("OCR processing timeout")
                        readable, _, _ = select.select([self.connection], [], [], 0.2)
                        if readable and not self.connection.recv(1, socket.MSG_PEEK):
                            raise ConnectionError("Request cancelled")
                    if proc.returncode:
                        return self.reply(422, b'{"error":"PDF processing failed or unsupported document"}')
                result = root / ("output.pdf" if config["mode"] == "pdf" else "output.json")
                if not result.exists() or result.stat().st_size > MAX_OUTPUT:
                    return self.reply(413, b'{}')
                self.reply(200, result.read_bytes(), "application/pdf" if config["mode"] == "pdf" else "application/json")
        except (ValueError, TimeoutError, OSError, ConnectionError):
            try:
                self.reply(422, b'{"error":"OCR could not complete safely"}')
            except OSError:
                pass
        finally:
            if proc and proc.poll() is None:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()
            SLOT.release()


if __name__ == "__main__":
    if len(TOKEN) < 32:
        raise SystemExit("Set a PDF_OCR_TOKEN of at least 32 characters")
    if os.environ.get("PDF_RESEARCH_OCR") == "1" and not Path("/home/ocr/models/manifest.json").is_file():
        raise SystemExit("Provision and verify the research model volume before starting this service")
    ThreadingHTTPServer(("0.0.0.0", 8091), Handler).serve_forever()
