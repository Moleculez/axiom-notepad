FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-writer libreoffice-impress fonts-liberation fonts-dejavu-core python3 && rm -rf /var/lib/apt/lists/*
RUN useradd --uid 10001 --no-create-home converter
COPY server.py /opt/converter/server.py
USER 10001:10001
EXPOSE 8090
ENTRYPOINT ["python3", "-I", "/opt/converter/server.py"]
