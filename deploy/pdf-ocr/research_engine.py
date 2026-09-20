"""CPU-only public text/formula models; never select paid or remote VLM engines."""
from pathlib import Path

MODEL_ROOT = Path("/home/ocr/models")
MODEL_REVISIONS = {
    "mfd": ("breezedeus/pix2text-mfd-1.5", "f470a885e0fca1d3d2bfa2a54991db7ae01f1861"),
    "mfr": ("breezedeus/pix2text-mfr-1.5", "1cef9f0bdcd6a4c63df7de1311fb0894593340cc"),
}
LANGUAGES = {"eng": ("en",), "chi_sim": ("ch_sim",), "eng+chi_sim": ("en", "ch_sim")}


def create_engine(language):
    if language not in LANGUAGES:
        raise ValueError("Equation-aware OCR supports English and Simplified Chinese")
    from pix2text.text_formula_ocr import TextFormulaOCR
    return TextFormulaOCR.from_config(
        {"languages": LANGUAGES[language],
         "mfd": {"model_path": str(MODEL_ROOT / "mfd" / "pix2text-mfd-1.5.onnx")},
         "formula": {"model_dir": str(MODEL_ROOT / "mfr"), "more_model_configs": {"provider": "CPUExecutionProvider"}}},
        device="cpu", enable_spell_checker=False,
    )
