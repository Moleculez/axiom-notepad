# Private CPU OCR

The PDF workbench has an optional, self-hosted OCR queue. It is separate from the
provider-backed paper assistant. Neither runs automatically. The user selects
pages, language and outputs, then explicitly starts processing.

**Acceptance status:** queue/checkpoint/cancellation/ownership/review conflicts
have been exercised against a real isolated database with a mocked OCR transport.
The review interface has browser acceptance. Docker was unavailable during this
increment: these images, model provisioning, resource limits and recognition
accuracy still need the operator acceptance below. Do not describe this as
production-validated OCR or enable it without that check.

## Outputs and boundaries

- Research text is private to the requester. Review it beside the source page,
  correct text/LaTeX, preview equations, mark each page reviewed, export Markdown
  with immutable page citations, insert it into an open note, or create a private
  research note. Only reviewed pages leave the review workflow through text export.
- Optional searchable PDF output preserves an immutable source and uses
  machine-recognized hidden text. **Review corrections do not rewrite this layer.**
  Download or explicitly save a workspace copy/version through the guarded PDF
  save dialog. Saving into a shared space is an intentional sharing action.
- Standard processing uses Tesseract and OCRmyPDF 17.12.1. The optional research
  image uses Pix2Text 1.1.4 text/formula recognition, public base ONNX models and CPU
  inference, not a remote VLM. Formula models use pinned Hugging Face revisions in
  `deploy/pdf-ocr/research_engine.py`. CnOCR/CnSTD text-model hashes and installed
  package versions are recorded at provisioning; archive that exact volume/image.
- Standard languages: English, Simplified Chinese, their combination, German,
  French and Spanish. Equation-aware recognition supports the first three only.
  Multi-column reading order, symbols, handwriting and low-resolution scans need
  manual review. No confidence score is invented.
- Input: 100 MiB, 2,000 pages. Each page is a durable checkpoint, rasterized to at
  most 3,000 pixels on its longer edge. Extracted text: 100,000 characters/page,
  8 MB/batch; combined original/corrected text: 16 MB. Searchable output: 200 MiB.
  Encrypted PDFs, forms and signatures are refused. Source annotations/bookmarks
  may still require downstream compatibility checks; this is not redaction.
- Text processing has a five-minute request deadline; searchable-PDF processing
  has one hour. Cancellation interrupts the current request/subprocess; completed
  pages survive retry. Container memory/tmpfs limits may reject large jobs before
  their logical limits: use smaller ranges. Pages currently resend source bytes
  through the private network; very large batches require throughput acceptance.
- Two pending jobs and 20 submissions/day/account. Results expire after 30 days;
  the regular workspace worker performs cleanup. Clearing private results keeps
  a quota receipt until expiry and does not delete copies saved in the workspace.
  Result blobs and corrections count against storage. Backups include completed
  OCR blobs; they are private research data too.

## Enable standard OCR

First deploy the updated application image and run the normal migrations/backup
procedure in [Deployment](DEPLOYMENT.md). Migrations 26–27 add guarded uploads,
threads, provenance and OCR state without replacing existing files.

Generate a dedicated token using `openssl rand -hex 32`, then put the following
values in the deployment's protected `.env` (do not commit the token):

```dotenv
PDF_OCR_URL=http://pdf-ocr:8091
PDF_OCR_TOKEN=YOUR_GENERATED_TOKEN
PDF_RESEARCH_OCR_URL=
```

From the repository root, after the updated main application image is available:

```sh
docker compose --profile pdf-ocr build pdf-ocr
docker compose --profile pdf-ocr up -d --force-recreate web pdf-ocr pdf-ocr-worker
docker compose --profile pdf-ocr exec pdf-ocr python -c 'import urllib.request; print(urllib.request.urlopen("http://127.0.0.1:8091/health").status)'
docker compose --profile pdf-ocr logs --tail=50 pdf-ocr-worker pdf-ocr
```

The profile adds a dedicated durable worker; the usual workspace worker must
remain running. OCR images have no public ports, no internet route, a read-only
root filesystem, dropped capabilities and bounded temporary storage. The worker
can reach both PostgreSQL/storage and the private OCR network. Do not publish
8091 or add OCR endpoints to the public reverse proxy. `/health` reports gateway
liveness, not model accuracy or successful document processing.

## Optional equation-aware models

Budget at least the configured 6 GiB container memory and additional host overhead;
this profile is not appropriate for a tiny Lightsail instance. Standard OCR is
configured for 2 GiB/one CPU. Research OCR uses two CPUs and one concurrent request.
Build and provision on a sufficiently capable machine; do not mount research
files, application secrets or database volumes into the provisioning container.

```sh
docker compose --profile pdf-research-ocr build pdf-research-ocr
docker volume create axiom_pdf-ocr-models
docker run --rm --network bridge --user 10001:10001 \
  -e HF_HUB_OFFLINE=0 -e TRANSFORMERS_OFFLINE=0 \
  -v axiom_pdf-ocr-models:/home/ocr \
  axiom-pdf-research-ocr:local python provision.py
docker run --rm --network none --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=1g,uid=10001,gid=10001,mode=700 \
  -v axiom_pdf-ocr-models:/home/ocr:ro \
  axiom-pdf-research-ocr:local python provision.py --verify
```

These names assume the default Compose project `axiom` and image tag. Substitute
the exact names if you override them. Provisioning refuses an existing manifest;
use a new volume for a deliberate model upgrade. Keep the generated manifest,
public model cards/licenses and pinned image digest in the release record. Python
transitive dependencies are not yet a fully hash-locked wheel set; freeze/review
the tested image before distribution. Review all bundled engine/model licenses,
including transitive components, rather than assuming one license covers them all.

After the offline checks and representative-document tests pass, set
`PDF_RESEARCH_OCR_URL=http://pdf-research-ocr:8091` and run:

```sh
docker compose --profile pdf-ocr --profile pdf-research-ocr up -d \
  --force-recreate web pdf-ocr-worker pdf-ocr pdf-research-ocr
```

Runtime model downloads are disabled; missing models fail rather than contacting
an external provider. Provisioning is the only deliberately network-enabled step.

## Operator acceptance checklist

1. Build both images on the target architecture, retain dependency/model manifests
   and verify offline CPU initialization with no internet route.
2. Use non-sensitive fixtures: born-digital PDF, scanned prose, mixed text/scans,
   equations, CJK, cropped/rotated pages, damaged PDF, and password/form/signature
   PDFs. Confirm explicit refusals and bounded failures.
3. Check both outputs visually and search/copy the hidden text. Review equations
   independently. Confirm source bytes and page geometry stay unchanged.
4. Cancel during a page and during PDF generation, restart the worker, and retry.
   Verify completed pages survive and there is at most one output artifact.
5. Test quota exhaustion, expiry, clearing results, backup/restore, two accounts,
   private/shared files, source movement/Trash and access revocation.
6. Measure CPU, RAM, scratch space and duration on realistic papers before raising
   any limits. Runtime error logs intentionally omit PDF contents and tokens.

Implementation references: [OCRmyPDF documentation](https://ocrmypdf.readthedocs.io/),
[Pix2Text text/formula API](https://github.com/breezedeus/Pix2Text/blob/v1.1.4/pix2text/text_formula_ocr.py),
[public detection model](https://huggingface.co/breezedeus/pix2text-mfd-1.5), and
[public recognition model](https://huggingface.co/breezedeus/pix2text-mfr-1.5).
