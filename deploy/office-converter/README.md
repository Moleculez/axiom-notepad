# Private Office preview service

Run with the optional `research-tools` Compose profile. The converter has no
published port, no database/storage credentials, no persistent volume, and only
an internal network to the worker. It runs as UID 10001 with a read-only root,
dropped capabilities, process/memory/CPU limits and a bounded temporary volume.
LibreOffice receives a fresh temporary profile for every conversion. Macro
execution and automatic link updates are disabled. Macro-bearing archives and
embedded OLE objects are rejected. Originals are never modified.

Set `OFFICE_CONVERTER_TOKEN` to a unique secret in the deployment environment,
and `OFFICE_CONVERTER_URL=http://office-converter:8090` for web and worker.
Then use `docker compose --profile research-tools up -d --build`.

Do not expose this service to users or connect it to the public/default network.
Do not run untrusted document conversion directly on a developer workstation.
Fonts affect pagination; common Liberation/DejaVu fonts are included. Unsupported
formatting falls back to a clearly marked original-file download. Conversion
limits: 50 MB input, 200 MB expanded archive, 80 MB PDF, 75 seconds wall time.

Converter changes require changing the `office-pdf-v1` derivative cache key in
the application; a derivative always belongs to an immutable source version.
For highly hostile multi-tenant deployments, isolate each job in its own hardened
container/VM in addition to these process and network constraints.
