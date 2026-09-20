FROM python:3.12-slim-bookworm AS standard
RUN apt-get update && apt-get install -y --no-install-recommends \
    ghostscript poppler-utils tesseract-ocr tesseract-ocr-eng tesseract-ocr-chi-sim \
    tesseract-ocr-deu tesseract-ocr-fra tesseract-ocr-spa fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir ocrmypdf==17.12.1
RUN useradd --uid 10001 --create-home ocr
WORKDIR /service
COPY server.py process.py ./
ENV PYTHONDONTWRITEBYTECODE=1 OMP_THREAD_LIMIT=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1
USER 10001:10001
EXPOSE 8091
CMD ["python", "server.py"]

FROM standard AS research
USER root
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.8.0 torchvision==0.23.0
RUN pip install --no-cache-dir 'pix2text==1.1.4' 'transformers<5'
COPY research_engine.py provision.py ./
USER 10001:10001
ENV PDF_RESEARCH_OCR=1 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 MPLCONFIGDIR=/tmp/matplotlib YOLO_CONFIG_DIR=/tmp/ultralytics
