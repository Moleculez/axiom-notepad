"use client";
import { useEffect, useRef, useState } from "react";
import type { AssistantSelection } from "@axiom/shared/assistant";
import type { OfficeExcerptSource } from "@axiom/shared/assistant-office";
import { api, post } from "../../lib/client";
import Dialog, { DialogFooter } from "../Dialog";
import { ErrorNotice } from "../workspace/ui";
export default function AssistantOfficeExcerpt({
  id,
  versionId,
  format,
  onPick,
  onClose,
}: {
  id: string;
  versionId: string;
  format: "docx" | "pptx" | "xlsx";
  onPick: (value: AssistantSelection) => void;
  onClose: () => void;
}) {
  const [jobId] = useState(() => crypto.randomUUID()),
    [data, setData] = useState<OfficeExcerptSource | null>(null),
    [status, setStatus] = useState("Preparing local extraction…"),
    [error, setError] = useState(""),
    [range, setRange] = useState({ from: 0, to: 0 });
  const source = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    let alive = true,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const job = await api<{
          status: string;
          result?: OfficeExcerptSource;
          error?: string;
        }>(`assistant/extractions/${jobId}`);
        if (!alive) return;
        setStatus(job.status);
        if (job.status === "complete" && job.result) {
          setData(job.result);
          if (job.result.source.length <= 30000)
            setRange({ from: 0, to: job.result.source.length });
        } else if (["failed", "cancelled", "uncertain"].includes(job.status))
          setError(
            job.error ?? "Extraction stopped. Close and reopen to retry.",
          );
        else timer = setTimeout(poll, 1000);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    void post("assistant/extractions", { id: jobId, versionId, format })
      .then(() => {
        if (alive) void poll();
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [jobId, versionId, format]);
  const count = range.to - range.from;
  const close = () => {
    if (!data)
      void api(`assistant/extractions/${jobId}`, { method: "DELETE" }).catch(
        () => {},
      );
    onClose();
  };
  return (
    <Dialog
      title="Select Office evidence"
      subtitle="Private server extraction · No AI request is sent"
      onClose={close}
    >
      <ErrorNotice message={error} />
      {!data ? (
        <p role="status">{status}</p>
      ) : (
        <>
          <p className="ws-note">
            Select a passage, slide, or worksheet rows. Saved formulas are not
            recalculated. Hidden cells/notes may be present; review before
            sending.
          </p>
          {data.warnings.map((w) => (
            <p className="ws-note" key={w}>
              {w}
            </p>
          ))}
          <label>
            Jump to a source block
            <select
              defaultValue=""
              onChange={(e) => {
                const item = data.locators[Number(e.target.value)];
                if (item) {
                  setRange({ from: item.from, to: item.to });
                  source.current?.focus();
                  source.current?.setSelectionRange(item.from, item.to);
                }
              }}
            >
              <option value="" disabled>
                Select a block…
              </option>
              {data.locators.map((l, i) => (
                <option key={i} value={i}>
                  {l.label} · {l.target}
                </option>
              ))}
            </select>
          </label>
          <textarea
            className="assistant-excerpt"
            ref={source}
            readOnly
            rows={14}
            aria-label="Extracted Office source"
            value={data.source}
            onSelect={(e) => {
              const t = e.currentTarget;
              if (t.selectionEnd > t.selectionStart)
                setRange({ from: t.selectionStart, to: t.selectionEnd });
            }}
          />
          <div className="productivity-subtoolbar">
            <label>
              From character
              <input
                type="number"
                min={0}
                max={data.source.length}
                value={range.from}
                onChange={(e) =>
                  setRange({ ...range, from: Number(e.target.value) })
                }
              />
            </label>
            <label>
              To character
              <input
                type="number"
                min={1}
                max={data.source.length}
                value={range.to}
                onChange={(e) =>
                  setRange({ ...range, to: Number(e.target.value) })
                }
              />
            </label>
            <span>{count.toLocaleString()} / 30,000 characters</span>
          </div>
        </>
      )}
      <DialogFooter>
        <button className="button secondary" onClick={close}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={
            !data ||
            count < 1 ||
            count > 30000 ||
            range.from < 0 ||
            range.to > (data?.source.length ?? 0)
          }
          onClick={() => {
            onPick({
              kind: "office",
              id,
              versionId,
              extractionId: jobId,
              ...range,
            });
            onClose();
          }}
        >
          Add selected evidence
        </button>
      </DialogFooter>
    </Dialog>
  );
}
