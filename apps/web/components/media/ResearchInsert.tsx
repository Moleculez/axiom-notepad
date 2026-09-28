"use client";
import { useEffect, useRef, useState } from "react";
import type { Resource } from "@axiom/shared/workspace";
import { annotationMarkdown, type Annotation } from "@axiom/shared/research";
import { parseDelimited } from "@axiom/shared/file-preview";
import { escapeCell } from "@axiom/markdown";
import { ErrorNotice, useData } from "../workspace/ui";
export default function ResearchInsert({
  resource,
  onInsert,
  shared,
}: {
  resource: Resource;
  onInsert: (value: string) => void;
  shared: boolean;
}) {
  const [open, setOpen] = useState(false),
    [chosen, setChosen] = useState(""),
    [acknowledge, setAcknowledge] = useState(false),
    [citeKey, setCiteKey] = useState(""),
    [rows, setRows] = useState<string[][]>([]),
    [start, setStart] = useState(1),
    [end, setEnd] = useState(10),
    [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    setChosen("");
    setRows([]);
    setError("");
    setAcknowledge(false);
    return () => request.current?.abort();
  }, [resource.id, resource.current_version_id]);
  const pdf = resource.mime === "application/pdf",
    csv = /\.(csv|tsv)$/i.test(resource.name);
  const annotations = useData<Annotation[]>(
    open && pdf
      ? `attachments/${resource.current_version_id}/annotations`
      : null,
  );
  const selected = annotations.data?.find((entry) => entry.id === chosen);
  if (!pdf && !csv) return null;
  const load = async () => {
    if ((resource.bytes ?? Infinity) > 1_000_000) {
      setError(
        "Excerpt loading is limited to 1 MB. Open the full dataset viewer for larger files.",
      );
      return;
    }
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    try {
      const response = await fetch(
        `/api/v1/files/${resource.id}/content?version=${resource.current_version_id}`,
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error("Dataset unavailable.");
      const value = await response.text();
      if (new TextEncoder().encode(value).length > 1_000_000)
        throw new Error("Dataset exceeds the excerpt limit.");
      if (!controller.signal.aborted)
        setRows(
          parseDelimited(
            value,
            /\.tsv$/i.test(resource.name) ? "\t" : ",",
            201,
          ).map((row) => row.slice(0, 20)),
        );
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    }
  };
  return (
    <details
      className="media-research"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        {pdf ? "Insert a research quotation" : "Insert a dataset excerpt"}
      </summary>
      <ErrorNotice message={error || annotations.error} />
      {pdf ? (
        <>
          <label>
            Saved annotation
            <select
              value={chosen}
              onChange={(e) => {
                setChosen(e.target.value);
                setAcknowledge(false);
              }}
            >
              <option value="">Choose a quotation…</option>
              {annotations.data
                ?.filter((entry) => !entry.deleted)
                .map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    p. {entry.data.page} ·{" "}
                    {entry.data.quote.slice(0, 100) ||
                      entry.data.body.slice(0, 100)}
                  </option>
                ))}
            </select>
          </label>
          {!annotations.loading && !annotations.data?.length && (
            <p className="ws-small muted">
              No saved annotations. Open the PDF reader to select and annotate a
              passage.
            </p>
          )}
          {selected && <blockquote>{selected.data.quote}</blockquote>}
          <label>
            Citation key (optional)
            <input
              value={citeKey}
              placeholder="author2026"
              onChange={(e) =>
                setCiteKey(e.target.value.replace(/[^\w:./-]/g, ""))
              }
            />
          </label>
          {shared && selected && !selected.shared && (
            <label className="media-check-label">
              <input
                type="checkbox"
                checked={acknowledge}
                onChange={(e) => setAcknowledge(e.target.checked)}
              />
              Include this private annotation in the shared note
            </label>
          )}
          <button
            className="button secondary"
            disabled={!selected || (shared && !selected.shared && !acknowledge)}
            onClick={() =>
              selected &&
              onInsert(
                annotationMarkdown(
                  selected,
                  resource.name,
                  citeKey || undefined,
                ),
              )
            }
          >
            Insert quotation with source
          </button>
        </>
      ) : (
        <>
          <p className="ws-small muted">
            A frozen Markdown table, linked to this file version. Up to 200 rows
            and 20 columns; formulas are never executed.
          </p>
          {!rows.length ? (
            <button className="button secondary" onClick={() => void load()}>
              Load excerpt
            </button>
          ) : (
            <>
              <div className="media-options-pair">
                <label>
                  First data row
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={start}
                    onChange={(e) =>
                      setStart(
                        Math.max(1, Math.min(200, Number(e.target.value) || 1)),
                      )
                    }
                  />
                </label>
                <label>
                  Last data row
                  <input
                    type="number"
                    min={start}
                    max={200}
                    value={end}
                    onChange={(e) =>
                      setEnd(
                        Math.max(
                          start,
                          Math.min(200, Number(e.target.value) || start),
                        ),
                      )
                    }
                  />
                </label>
              </div>
              <button
                className="button secondary"
                disabled={rows.length < 2 || start >= rows.length}
                onClick={() => {
                  const selectedRows = [
                      rows[0],
                      ...rows.slice(start, Math.max(start, end) + 1),
                    ],
                    width = Math.max(...selectedRows.map((row) => row.length));
                  const line = (row: string[]) =>
                    "| " +
                    Array.from({ length: width }, (_, at) =>
                      escapeCell(row[at] ?? ""),
                    ).join(" | ") +
                    " |";
                  onInsert(
                    [
                      line(selectedRows[0]),
                      line(Array(width).fill("---")),
                      ...selectedRows.slice(1).map(line),
                    ].join("\n") +
                      `\n\n[${resource.name.replace(/[\[\]\\]/g, "\\$&")}, rows ${start}–${Math.min(rows.length - 1, Math.max(start, end))}](/api/v1/attachments/${resource.current_version_id})`,
                  );
                }}
              >
                Insert table with source
              </button>
            </>
          )}
        </>
      )}
    </details>
  );
}
