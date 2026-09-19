"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Copy, Send, ShieldCheck, Trash2, X } from "lucide-react";
import { pdfAnswerCitations, pdfPageRange } from "@axiom/shared/pdf-reader";
import { api, post } from "../../lib/client";
import { confirmAction } from "../../lib/app-prompt";
type Provider = {
  id: string;
  name: string;
  model: string;
  capabilities: string[];
};
type Job = {
  id: string;
  version_id: string;
  kind: string;
  status: string;
  error?: string;
  result?: { text: string; source: string; context?: string };
};
type Evidence = { source: string; image?: string; pages: number[] };
const prompts = {
  explain:
    "Explain the key ideas and assumptions in these pages. Separate the author's claims from interpretation.",
  summarize:
    "Summarize the research question, method, findings and limitations supported by these pages. State what is missing.",
  question: "",
  translate:
    "Translate these excerpts into English, preserving equations and technical terminology.",
  ocr: "Transcribe this page as LaTeX, preserving mathematical notation. Flag uncertain symbols.",
};
export default function PaperAssistant({
  pdf,
  resourceId,
  versionId,
  page,
  onPage,
  onClose,
  onInsert,
}: {
  pdf: PDFDocumentProxy;
  resourceId: string;
  versionId: string;
  page: number;
  onPage: (page: number) => void;
  onClose: () => void;
  onInsert: (text: string, privateMaterial?: boolean) => void;
}) {
  const [providers, setProviders] = useState<Provider[]>([]),
    [providerId, setProviderId] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const [action, setAction] = useState<keyof typeof prompts>("explain"),
    [prompt, setPrompt] = useState(prompts.explain);
  const [range, setRange] = useState(String(page)),
    [evidence, setEvidence] = useState<Evidence | null>(null);
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false);
  const alive = useRef(true),
    generation = useRef(0);
  const provider = providers.find((p) => p.id === providerId);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void api<Provider[]>(`tool-providers?resource=${resourceId}`, {
      signal: controller.signal,
    })
      .then((values) => {
        if (alive.current)
          setProviders(values.filter((p) => p.capabilities.includes("paper")));
      })
      .catch((e) => {
        if (alive.current) setError(e.message);
      });
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const values = await api<Job[]>(`tool-jobs?resource=${resourceId}`, {
          signal: controller.signal,
        });
        if (!alive.current) return;
        setJobs(values.filter((j) => j.version_id === versionId));
      } catch (e) {
        if (alive.current) setError((e as Error).message);
      }
      if (alive.current) timer = setTimeout(() => void refresh(), 4000);
    };
    void refresh();
    return () => {
      alive.current = false;
      generation.current++;
      controller.abort();
      clearTimeout(timer);
    };
  }, [resourceId, versionId]);
  const prepare = async () => {
    const token = ++generation.current;
    setBusy(true);
    setError("");
    setEvidence(null);
    setConsent(false);
    try {
      const pages = pdfPageRange(range, pdf.numPages);
      if (pages.length > 20)
        throw new Error(
          "Choose up to 20 pages per request. Whole-paper batching is not available yet.",
        );
      if (action === "ocr" && pages.length !== 1)
        throw new Error("For OCR, choose one page per request.");
      let source = "",
        image: string | undefined;
      for (const n of pages) {
        const p = await pdf.getPage(n);
        if (!alive.current || token !== generation.current) return;
        if (action === "ocr") {
          const natural = p.getViewport({ scale: 1 });
          const viewport = p.getViewport({
            scale: Math.min(2, 1800 / Math.max(natural.width, natural.height)),
          });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          try {
            await p.render({ canvas, viewport, background: "#ffffff" }).promise;
            image = canvas.toDataURL("image/png");
            if (image.length > 12_000_000)
              throw new Error(
                "This raster exceeds the upload limit. Try a smaller source PDF.",
              );
          } finally {
            canvas.width = canvas.height = 0;
          }
          source = `[p. ${n}]\nImage of physical PDF page ${n}.`;
        } else {
          const content = await p.getTextContent();
          const text = content.items
            .map((item) =>
              "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
            )
            .join("");
          if (!text.trim())
            throw new Error(
              `Page ${n} has no extractable text. Choose OCR for that page.`,
            );
          // Escape source-like page markers; only our evidence boundaries are trusted.
          source += `[p. ${n}]\n${text.replace(/^\[p\. (\d+)\]$/gm, "(document marker p. $1)")}\n\n`;
          if (source.length > 30000)
            throw new Error(
              "These pages exceed 30,000 characters. Choose a smaller range; nothing has been sent.",
            );
        }
      }
      if (alive.current && token === generation.current)
        setEvidence({ source, image, pages });
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const submit = async () => {
    if (!evidence || !consent || !provider || !prompt.trim()) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const job = await post("tool-jobs", {
        resourceId,
        versionId,
        context: "paper",
        providerId,
        kind: action === "ocr" ? "ocr" : "explain",
        source: evidence.source,
        image: evidence.image,
        prompt,
        consent: true,
      });
      if (!alive.current) return;
      setJobs((old) => [{ ...job, version_id: versionId }, ...old]);
      setConsent(false);
      setStatus(
        "Submitted once. You can continue reading while the worker processes it.",
      );
    } catch (e) {
      if (alive.current)
        setError(
          `${(e as Error).message} Check request history before submitting again; no automatic retry was made.`,
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const remove = async (job: Job) => {
    if (
      !(await confirmAction(
        "This removes the saved prompt and response. A provider may already have received the material; deletion cannot recall it. The request still counts toward the daily quota.",
        {
          title: "Delete private response?",
          confirmLabel: "Delete",
          destructive: true,
        },
      ))
    )
      return;
    try {
      await api(`tool-jobs/${job.id}`, { method: "DELETE" });
      setJobs((old) => old.filter((j) => j.id !== job.id));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <aside className="pdf-assistant pdf-composer" aria-label="Paper assistant">
      <header>
        <strong>
          <ShieldCheck size={15} /> Paper assistant
        </strong>
        <button
          className="icon-button"
          aria-label="Close paper assistant"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </header>
      <p className="muted">
        Private to your account. Only reviewed excerpts go to the selected
        provider. Responses may be wrong; verify against the paper.
      </p>
      {!providers.length && (
        <p role="status">
          No paper provider is enabled. A group administrator can opt in under
          processing providers. The reader works without AI.
        </p>
      )}
      <label>
        Provider
        <select
          aria-label="Paper assistant provider"
          value={providerId}
          onChange={(e) => {
            setProviderId(e.target.value);
            setConsent(false);
          }}
        >
          <option value="">Choose a provider</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.model}
            </option>
          ))}
        </select>
      </label>
      <label>
        Task
        <select
          value={action}
          onChange={(e) => {
            const next = e.target.value as keyof typeof prompts;
            setAction(next);
            setPrompt(prompts[next]);
            setEvidence(null);
            setConsent(false);
          }}
          disabled={busy}
        >
          {Object.keys(prompts).map((kind) => (
            <option key={kind} value={kind}>
              {kind === "ocr"
                ? "OCR / math transcription"
                : kind[0].toUpperCase() + kind.slice(1)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Physical page numbers
        <input
          aria-label="Assistant page range"
          value={range}
          disabled={busy}
          onChange={(e) => {
            setRange(e.target.value);
            setEvidence(null);
            setConsent(false);
          }}
          placeholder="1, 3-5"
        />
      </label>
      <button
        disabled={busy}
        onClick={() => {
          setRange(String(page));
          setEvidence(null);
          setConsent(false);
        }}
      >
        Use current page ({page})
      </button>
      <button
        className="button secondary small"
        disabled={
          busy || (action === "ocr" && !provider?.capabilities.includes("ocr"))
        }
        onClick={() => void prepare()}
      >
        {busy ? "Working…" : "Prepare context locally"}
      </button>
      {action === "ocr" && !provider?.capabilities.includes("ocr") && (
        <small>
          Choose a provider with both paper and image/OCR capabilities.
        </small>
      )}
      <label>
        Your request
        <textarea
          aria-label="Paper assistant request"
          rows={4}
          maxLength={10000}
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            setConsent(false);
          }}
          disabled={busy}
        />
      </label>
      {evidence && (
        <div className="pdf-evidence">
          <strong>
            Review before sending · pages {evidence.pages.join(", ")}
          </strong>
          <small>
            PDF version {versionId.slice(0, 8)} ·{" "}
            {evidence.source.length.toLocaleString()} characters
          </small>
          {evidence.image && (
            <img
              src={evidence.image}
              alt={`Exact raster to send for page ${evidence.pages[0]}`}
            />
          )}
          <details>
            <summary>Exact source text</summary>
            <pre>{evidence.source}</pre>
          </details>
          <label className="pdf-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            Send this context and request to{" "}
            {provider?.name ?? "the selected provider"}. Its retention and
            billing policies apply.
          </label>
        </div>
      )}
      <button
        className="button primary small"
        disabled={busy || !evidence || !provider || !consent || !prompt.trim()}
        onClick={() => void submit()}
      >
        <Send size={14} /> Submit once
      </button>
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      <h3>Private request history</h3>
      {jobs.length === 0 && (
        <p className="muted">No requests for this PDF version.</p>
      )}
      {jobs.map((job) => (
        <article className="pdf-assistant-result" key={job.id}>
          <header>
            <strong>
              {job.kind === "ocr" ? "Transcription" : "Reading response"} ·{" "}
              {job.status}
            </strong>
            <button
              className="icon-button"
              aria-label="Delete private response"
              onClick={() => void remove(job)}
            >
              <Trash2 size={14} />
            </button>
          </header>
          {job.error && <p role="alert">{job.error}</p>}
          {["queued", "running"].includes(job.status) && (
            <button
              onClick={() =>
                void post(`tool-jobs/${job.id}/cancel`, {})
                  .then(() => {
                    setJobs((old) =>
                      old.map((j) =>
                        j.id === job.id ? { ...j, status: "cancelled" } : j,
                      ),
                    );
                    setStatus(
                      "Cancellation requested. Material may already have reached the provider.",
                    );
                  })
                  .catch((e) => setError(e.message))
              }
            >
              Cancel request
            </button>
          )}
          {job.result?.text && (
            <>
              <pre>{job.result.text}</pre>
              <div className="pdf-citation-buttons">
                {pdfAnswerCitations(
                  job.result.text,
                  job.result.source ?? "",
                ).map((citation) =>
                  citation.supported ? (
                    <button
                      key={citation.page}
                      onClick={() => onPage(citation.page)}
                    >
                      Page {citation.page}
                    </button>
                  ) : (
                    <span key={citation.page}>
                      Unverified page {citation.page}
                    </span>
                  ),
                )}
              </div>
              <small>
                Page links validate supplied context, not the accuracy of the
                answer.
              </small>
              <div className="button-row">
                <button
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(job.result!.text)
                      .then(() => setStatus("Response copied."))
                      .catch((e) => setError(e.message))
                  }
                >
                  <Copy size={14} /> Copy
                </button>
                <button
                  onClick={() =>
                    onInsert(
                      `> AI-assisted draft — verify against the paper.\n\n${job.result!.text}\n\n[Source PDF version](/workbench/pdf/${resourceId}?version=${versionId})\n`,
                      true,
                    )
                  }
                >
                  Insert draft
                </button>
              </div>
            </>
          )}
        </article>
      ))}
    </aside>
  );
}
