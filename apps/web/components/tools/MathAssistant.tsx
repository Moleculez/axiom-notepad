"use client";
import { currentLocale } from "@axiom/i18n/client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import {
  Button,
  Checkbox,
  HelpText,
  NativeSelect,
  TextArea,
  TextInput,
} from "../ui/controls";
import { useEffect, useRef, useState } from "react";
import { Upload, Sparkles, ScanText, Copy, X } from "lucide-react";
import type { ToolJob } from "@axiom/shared/research-tools";
import { post } from "../../lib/client";
import { ErrorNotice, Loading, useData, useWorkspace } from "../workspace/ui";
import { imageCanvas } from "../../lib/tools/image-engine";
type Provider = {
  id: string;
  name: string;
  kind: "private" | "openrouter";
  model: string;
  capabilities: string[];
};
export default function MathAssistant({
  resourceId,
  source,
  onInsert,
  readOnly,
}: {
  resourceId: string;
  source: string;
  onInsert: (text: string) => void;
  readOnly: boolean;
}) {
  useInterfaceLocale();
  const providers = useData<Provider[]>(
      `tool-providers?resource=${resourceId}`,
    ),
    jobs = useData<ToolJob[]>(`tool-jobs?resource=${resourceId}`),
    { notify } = useWorkspace();
  const [provider, setProvider] = useState(""),
    [kind, setKind] = useState<"ocr" | "generate" | "check" | "explain">(
      "generate",
    ),
    [prompt, setPrompt] = useState(""),
    [image, setImage] = useState<string>(),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [original, setOriginal] = useState(source),
    [pdf, setPdf] = useState<File | null>(null),
    [page, setPage] = useState(1),
    [crop, setCrop] = useState<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null>(null);
  const picture = useRef<HTMLImageElement>(null),
    start = useRef<{ x: number; y: number } | null>(null);
  const selected = providers.data?.find((p) => p.id === provider),
    supported = providers.data?.filter((p) =>
      p.capabilities.includes(kind === "ocr" ? "ocr" : "math"),
    );
  useEffect(() => {
    setConsent(false);
  }, [provider, kind, prompt, image, source]);
  useEffect(() => {
    if (
      !jobs.data?.some((j) => j.status === "queued" || j.status === "running")
    )
      return;
    const timer = setInterval(jobs.revalidate, 2000);
    return () => clearInterval(timer);
  }, [jobs.data, jobs.revalidate]);
  const load = async (file: File) => {
    setError("");
    setCrop(null);
    if (file.size > 20_000_000)
      throw new Error("OCR input is limited to 20 MB before rasterization.");
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
      setPdf(file);
      return;
    }
    if (!/^image\/(png|jpeg|webp)$/.test(file.type))
      throw new Error("Choose PNG, JPEG, WebP or PDF.");
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height)),
        canvas = imageCanvas(
          Math.max(1, Math.round(bitmap.width * scale)),
          Math.max(1, Math.round(bitmap.height * scale)),
        );
      canvas
        .getContext("2d")!
        .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      setImage(canvas.toDataURL("image/png"));
    } finally {
      bitmap.close();
    }
  };
  const renderPdf = async () => {
    if (!pdf) return;
    setBusy(true);
    try {
      const lib = await import("pdfjs-dist");
      lib.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      const loading = lib.getDocument({
        data: await pdf.arrayBuffer(),
        enableXfa: false,
      });
      try {
        const document = await loading.promise;
        if (page < 1 || page > document.numPages)
          throw new Error(`Choose a page from 1 to ${document.numPages}.`);
        const p = await document.getPage(page),
          size = p.getViewport({ scale: 1 }),
          viewport = p.getViewport({
            scale: Math.min(2, 2400 / Math.max(size.width, size.height)),
          }),
          canvas = imageCanvas(
            Math.ceil(viewport.width),
            Math.ceil(viewport.height),
          );
        await p.render({ canvas, viewport }).promise;
        setImage(canvas.toDataURL("image/png"));
        setCrop(null);
      } finally {
        await loading.destroy();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="math-assistant">
      <HelpText>
        <I18nText id="Results are suggestions, not proof verification. Review alongside your original. Nothing is sent automatically or silently replaces your work." />
      </HelpText>
      <div className="tool-settings-fields">
        <label>
          <I18nText id="Task" />
          <NativeSelect
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="generate">
              <I18nText id="Generate LaTeX" />
            </option>
            <option value="check">
              <I18nText id="Check mathematics" />
            </option>
            <option value="explain">
              <I18nText id="Explain" />
            </option>
            <option value="ocr">
              <I18nText id="Image / PDF → LaTeX" />
            </option>
          </NativeSelect>
        </label>
        <label>
          <I18nText id="Provider" />
          <NativeSelect
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            <option value="">
              <I18nText id="Choose a provider…" />
            </option>
            {supported?.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name} ·{" "}
                {p.kind === "private" ? uiText("private") : uiText("external")}{" "}
                · {p.model}
              </option>
            ))}
          </NativeSelect>
        </label>
        {providers.loading ? (
          <Loading />
        ) : (
          !supported?.length && (
            <HelpText>
              <I18nText id="No compatible provider is enabled. A group administrator can add one under Group administration → Providers." />
            </HelpText>
          )
        )}
        <label className="tool-setting-stack">
          <I18nText id="Instructions" />
          <TextArea
            rows={3}
            maxLength={10000}
            placeholder={uiText(
              "Describe the expression or the question you want checked…",
            )}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </label>
        {kind === "ocr" && (
          <div
            className="ocr-input"
            tabIndex={0}
            onPaste={(e) => {
              const file = Array.from(e.clipboardData.files).find((f) =>
                f.type.startsWith("image/"),
              );
              if (file) {
                e.preventDefault();
                void load(file).catch((e) => setError(e.message));
              }
            }}
          >
            <label className="button secondary">
              <Upload size={15} />
              <I18nText id="Choose image or PDF" />
              <input
                type="file"
                hidden
                accept="image/png,image/jpeg,image/webp,application/pdf"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void load(f).catch((e) => setError(e.message));
                  e.target.value = "";
                }}
              />
            </label>
            <small>
              <I18nText id="Or paste an image here. Drag over the preview to crop." />
            </small>
            {pdf && (
              <div className="tool-controls">
                <span>{pdf.name}</span>
                <label>
                  <I18nText id="Page" />
                  <TextInput
                    aria-label={uiText("PDF page for OCR")}
                    type="number"
                    min={1}
                    value={page}
                    onChange={(e) => setPage(Number(e.target.value))}
                  />
                </label>
                <Button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void renderPdf()}
                >
                  <I18nText id="Preview selected page" />
                </Button>
              </div>
            )}
            {image && (
              <>
                <div
                  className="ocr-crop"
                  onPointerDown={(e) => {
                    const r = picture.current!.getBoundingClientRect();
                    start.current = {
                      x: Math.max(
                        0,
                        Math.min(1, (e.clientX - r.left) / r.width),
                      ),
                      y: Math.max(
                        0,
                        Math.min(1, (e.clientY - r.top) / r.height),
                      ),
                    };
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    if (!start.current) return;
                    const r = picture.current!.getBoundingClientRect(),
                      x = Math.max(
                        0,
                        Math.min(1, (e.clientX - r.left) / r.width),
                      ),
                      y = Math.max(
                        0,
                        Math.min(1, (e.clientY - r.top) / r.height),
                      );
                    setCrop({
                      x: Math.min(start.current.x, x),
                      y: Math.min(start.current.y, y),
                      width: Math.abs(start.current.x - x),
                      height: Math.abs(start.current.y - y),
                    });
                  }}
                  onPointerUp={() => {
                    start.current = null;
                  }}
                >
                  <img
                    ref={picture}
                    src={image}
                    alt="Material selected for OCR"
                    draggable={false}
                  />
                  {crop && (
                    <span
                      style={{
                        left: `${crop.x * 100}%`,
                        top: `${crop.y * 100}%`,
                        width: `${crop.width * 100}%`,
                        height: `${crop.height * 100}%`,
                      }}
                    />
                  )}
                </div>
                <div className="tool-controls">
                  <Button
                    className="button secondary"
                    disabled={!crop || crop.width < 0.01 || crop.height < 0.01}
                    onClick={() => {
                      if (!crop || !picture.current) return;
                      const img = picture.current,
                        c = imageCanvas(
                          Math.max(
                            1,
                            Math.round(img.naturalWidth * crop.width),
                          ),
                          Math.max(
                            1,
                            Math.round(img.naturalHeight * crop.height),
                          ),
                        );
                      c.getContext("2d")!.drawImage(
                        img,
                        crop.x * img.naturalWidth,
                        crop.y * img.naturalHeight,
                        c.width,
                        c.height,
                        0,
                        0,
                        c.width,
                        c.height,
                      );
                      setImage(c.toDataURL("image/png"));
                      setCrop(null);
                    }}
                  >
                    <I18nText id="Apply crop" />
                  </Button>
                  <Button
                    className="button ghost"
                    onClick={() => {
                      setImage(undefined);
                      setCrop(null);
                    }}
                  >
                    <I18nText id="Remove image" />
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
        <details>
          <summary>
            <I18nText id="LaTeX included in this request" />
          </summary>
          <pre className="tool-submission-source">{source || "(empty)"}</pre>
        </details>
        <label className="tool-consent">
          <Checkbox
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>
            <I18nText id="I approve sending this source, my instructions" />
            {kind === "ocr" ? uiText(", and the displayed image") : ""}{" "}
            <I18nText id="to" /> {selected?.name ?? "the selected provider"}
            {selected?.kind === "openrouter"
              ? uiText(" through OpenRouter and its model provider")
              : ""}
            <I18nText id=". I have permission to submit this research material." />
          </span>
        </label>
        <Button
          className="button primary"
          disabled={
            readOnly ||
            busy ||
            !consent ||
            !selected ||
            !supported?.some((p) => p.id === selected.id) ||
            (kind === "ocr" && !image)
          }
          onClick={() => {
            setBusy(true);
            setError("");
            setOriginal(source);
            void post("tool-jobs", {
              resourceId,
              providerId: provider,
              kind,
              source,
              prompt,
              image: kind === "ocr" ? image : undefined,
              consent: true,
            })
              .then(() => {
                setConsent(false);
                jobs.reload();
              })
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          {kind === "ocr" ? <ScanText size={15} /> : <Sparkles size={15} />}
          <I18nText id="Submit explicitly" />
        </Button>
      </div>
      <ErrorNotice message={error || providers.error || jobs.error} />
      <h3>
        <I18nText id="Requests and reviewed results" />
      </h3>
      {jobs.data?.map((job) => (
        <article key={job.id} className="tool-checkpoint">
          <div className="tools-section-heading">
            <strong>
              {job.kind} · {job.status}
            </strong>
            <small>
              {new Date(job.created_at).toLocaleString(currentLocale())}
            </small>
          </div>
          {job.error && <HelpText>{job.error}</HelpText>}
          {job.status === "queued" || job.status === "running" ? (
            <Button
              data-dialog-cancel
              className="button secondary"
              onClick={() =>
                void post(`tool-jobs/${job.id}/cancel`, {})
                  .then(() => jobs.reload())
                  .catch((e) => setError(e.message))
              }
            >
              <X size={14} />
              <I18nText id="Cancel request" />
            </Button>
          ) : job.result?.text ? (
            <>
              <div className="assistant-comparison">
                <div>
                  <small>
                    <I18nText id="Submitted source" />
                  </small>
                  <pre>{job.result.source ?? original}</pre>
                </div>
                <div>
                  <small>
                    <I18nText id="Provider response · review before use" />
                  </small>
                  <pre>{job.result.text}</pre>
                </div>
              </div>
              <Button
                className="button secondary"
                onClick={() =>
                  void navigator.clipboard.writeText(job.result!.text!).then(
                    () => notify("Provider result copied."),
                    () => setError("Clipboard access was denied."),
                  )
                }
              >
                <Copy size={14} />
                <I18nText id="Copy result" />
              </Button>
              <Button
                className="button secondary"
                disabled={readOnly}
                onClick={() => onInsert(job.result!.text!)}
              >
                <I18nText id="Insert reviewed result at selection" />
              </Button>
            </>
          ) : null}
        </article>
      ))}
    </div>
  );
}
