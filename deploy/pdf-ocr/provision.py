"""Explicit network-enabled model bootstrap. Run without any user documents mounted."""
import hashlib
import importlib.metadata
import json
import sys
from pathlib import Path
from huggingface_hub import snapshot_download
from research_engine import MODEL_ROOT, MODEL_REVISIONS, LANGUAGES, create_engine


def main():
    manifest = MODEL_ROOT / "manifest.json"
    if manifest.exists():
        raise SystemExit("A manifest already exists. Keep that model volume immutable; provision a new volume for upgrades.")
    MODEL_ROOT.mkdir(parents=True, exist_ok=True)
    for name, (repo, revision) in MODEL_REVISIONS.items():
        snapshot_download(repo, revision=revision, local_dir=str(MODEL_ROOT / name))
    # CnOCR / CnSTD obtain their fixed named text models in the same private home.
    # Load each supported language during this explicit network-enabled phase.
    for language in LANGUAGES:
        create_engine(language)
    root = Path("/home/ocr")
    files = {}
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.is_symlink() or "/.cache/" in str(path):
            continue
        with path.open("rb") as stream:
            files[str(path.relative_to(root))] = hashlib.file_digest(stream, "sha256").hexdigest()
    manifest.write_text(json.dumps({"models": MODEL_REVISIONS, "files": files,
        "packages": {d.metadata["Name"]: d.version for d in importlib.metadata.distributions()}}, indent=2))
    print("Models provisioned. Archive this volume and manifest with the exact container image; run the offline acceptance checklist before enabling research OCR.")


if __name__ == "__main__":
    if "--verify" in sys.argv:
        root = Path("/home/ocr")
        manifest = json.loads((MODEL_ROOT / "manifest.json").read_text())
        for name, expected in manifest["files"].items():
            path = (root / name).resolve()
            if not path.is_relative_to(root) or not path.is_file():
                raise SystemExit("Missing or invalid model artifact")
            with path.open("rb") as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != expected:
                    raise SystemExit("Model checksum mismatch: " + name)
        for language in LANGUAGES:
            create_engine(language)
        print("Model checksums and CPU initialization verified. Recognition quality still requires review of representative scans.")
    else:
        main()
