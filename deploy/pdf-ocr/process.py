"""Single bounded subprocess; no shell, remote URLs, macros, or model downloads."""
import json
import os
from pathlib import Path
import resource
import subprocess
import sys


def run(args, timeout=120):
    subprocess.run(args, check=True, timeout=timeout, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL)


def main(directory):
    root = Path(directory)
    settings = json.loads((root / "settings.json").read_text())
    source = str(root / "source.pdf")
    import pikepdf
    with pikepdf.open(source) as document:
        if document.is_encrypted or "/AcroForm" in document.Root:
            raise ValueError("Encrypted, form, and signature PDFs are not transformed")
        if len(document.pages) > 2000 or any(p > len(document.pages) for p in settings["pages"]):
            raise ValueError("Page selection exceeds this document")
    if settings["mode"] == "pdf":
        run(["ocrmypdf", "--jobs", "1", "--skip-text", "--output-type", "pdf", "--optimize", "0", "--tesseract-timeout", "120", "--pages", ",".join(map(str, settings["pages"])), "-l", settings["language"], source, str(root / "output.pdf")], 3550)
        return
    page = str(settings["pages"][0])
    text_file = root / "native.txt"
    run(["pdftotext", "-f", page, "-l", page, "-layout", source, str(text_file)])
    text = text_file.read_text(errors="replace").strip()
    native = bool(text)
    if not native or settings["mode"] == "research":
        run(["pdftoppm", "-f", page, "-l", page, "-singlefile", "-scale-to", "3000", "-png", source, str(root / "page")])
        if settings["mode"] == "research":
            from research_engine import create_engine
            # Models must be provisioned explicitly; runtime has no internet route.
            engine = create_engine(settings["language"])
            text = engine.recognize(str(root / "page.png"), return_text=True)
            native = False
        else:
            run(["tesseract", str(root / "page.png"), str(root / "ocr"), "-l", settings["language"]])
            text = (root / "ocr.txt").read_text(errors="replace").strip()
    if not isinstance(text, str) or len(text) > 100000:
        raise ValueError("Extracted page text exceeds its limit")
    (root / "output.json").write_text(json.dumps({"text": text, "native": native}, ensure_ascii=False))


if __name__ == "__main__":
    resource.setrlimit(resource.RLIMIT_FSIZE, (220 * 1024 * 1024, 220 * 1024 * 1024))
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    main(sys.argv[1])
