"use client";
import { useEffect, useMemo, useState } from "react";
import type { AssistantSelection } from "@axiom/shared/assistant";
import type { RevisionContent } from "@axiom/shared/revisions";
import Dialog from "../Dialog";
import { ErrorNotice, useData } from "../workspace/ui";

type DocumentSelection = Extract<AssistantSelection, { kind: "document" }>;
export default function AssistantExcerpt({
  selection,
  onChoose,
  onClose,
}: {
  selection: DocumentSelection;
  onChoose: (selection: DocumentSelection, label: string) => void;
  onClose: () => void;
}) {
  const data = useData<RevisionContent>(
    `resources/${selection.id}/history/current`,
  );
  const body = data.data?.body ?? "";
  const [range, setRange] = useState({ from: 0, to: 0 });
  const offsets = useMemo(
    () => [0, ...[...body.matchAll(/\n/g)].map((m) => m.index + 1)],
    [body],
  );
  const lineAt = (offset: number) => {
    let low = 0,
      high = offsets.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (offsets[middle] <= offset) low = middle + 1;
      else high = middle;
    }
    return Math.max(1, low);
  };
  useEffect(() => {
    if (data.data)
      setRange(
        selection.hash === data.data.hash
          ? { from: selection.from ?? 0, to: selection.to ?? body.length }
          : { from: 0, to: body.length },
      );
  }, [data.data, body, selection]);
  const length = range.to - range.from;
  return (
    <Dialog
      title="Choose document excerpt"
      subtitle={data.data?.title ?? "Loading source…"}
      onClose={onClose}
    >
      <p className="ws-note">
        Select text below or choose line numbers. Only this exact passage will
        be attached. Changed server text requires a fresh selection.
      </p>
      <ErrorNotice message={data.error} />
      {data.loading ? (
        <p role="status">Loading saved document…</p>
      ) : (
        data.data && (
          <>
            <div className="assistant-fields">
              <label>
                From line
                <input
                  aria-label="Excerpt from line"
                  type="number"
                  min={1}
                  max={offsets.length}
                  value={lineAt(range.from)}
                  onChange={(e) => {
                    const from =
                      offsets[
                        Math.max(
                          0,
                          Math.min(
                            offsets.length - 1,
                            Number(e.target.value) - 1,
                          ),
                        )
                      ] ?? 0;
                    setRange((r) => ({ from, to: Math.max(from, r.to) }));
                  }}
                />
              </label>
              <label>
                Through line
                <input
                  aria-label="Excerpt through line"
                  type="number"
                  min={1}
                  max={offsets.length}
                  value={lineAt(Math.max(range.from, range.to - 1))}
                  onChange={(e) => {
                    const to =
                      offsets[
                        Math.max(
                          1,
                          Math.min(offsets.length, Number(e.target.value)),
                        )
                      ] ?? body.length;
                    setRange((r) => ({ from: Math.min(r.from, to), to }));
                  }}
                />
              </label>
            </div>
            <textarea
              className="assistant-excerpt-source"
              aria-label="Document excerpt source"
              readOnly
              value={body}
              onSelect={(e) => {
                const el = e.currentTarget;
                if (el.selectionStart !== el.selectionEnd)
                  setRange({ from: el.selectionStart, to: el.selectionEnd });
              }}
            />
            <p className={length > 30000 ? "form-error" : "ws-note"}>
              {length.toLocaleString()} / 30,000 characters selected
            </p>
            <details>
              <summary>Selected passage</summary>
              <pre className="assistant-excerpt">
                {body.slice(range.from, range.to)}
              </pre>
            </details>
          </>
        )
      )}
      <div className="dialog-footer">
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={!data.data || !!data.error || !length || length > 30000}
          onClick={() =>
            onChoose(
              { ...selection, ...range, hash: data.data!.hash },
              `${data.data!.title} · lines ${lineAt(range.from)}–${lineAt(Math.max(range.from, range.to - 1))}`,
            )
          }
        >
          Use selected excerpt
        </button>
      </div>
    </Dialog>
  );
}
