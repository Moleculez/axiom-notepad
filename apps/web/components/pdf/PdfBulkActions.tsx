"use client";
import { useState } from "react";
import type { Annotation } from "@axiom/shared/research";
import { api } from "../../lib/client";
import { confirmAction } from "../../lib/app-prompt";
export default function PdfBulkActions({
  marks,
  onClear,
  onRefresh,
}: {
  marks: Annotation[];
  onClear: () => void;
  onRefresh: () => void;
}) {
  const [action, setAction] = useState("color"),
    [value, setValue] = useState("yellow"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [undo, setUndo] = useState<{ before: Annotation; after: Annotation }[]>(
    [],
  );
  const apply = async (restore = false) => {
    if (busy) return;
    if (
      !restore &&
      ["delete", "share"].includes(action) &&
      !(await confirmAction(
        action === "delete"
          ? "Remove these annotations? Their discussions will be hidden until restored."
          : "Share these annotations and their discussions with everyone who can read this paper?",
        {
          title:
            action === "delete"
              ? "Remove selected annotations?"
              : "Share selected annotations?",
          confirmLabel: "Continue",
        },
      ))
    )
      return;
    setBusy(true);
    setMessage("");
    let succeeded = 0;
    const failures: string[] = [],
      changes: { before: Annotation; after: Annotation }[] = [];
    for (const record of restore
      ? undo.map((v) => ({ before: v.after, desired: v.before }))
      : marks.slice(0, 100).map((before) => ({ before, desired: before }))) {
      const { before, desired } = record;
      try {
        const data = restore
          ? desired.data
          : action === "color"
            ? { ...before.data, color: value }
            : action === "tag"
              ? {
                  ...before.data,
                  tags: [
                    ...new Set([...(before.data.tags ?? []), value.trim()]),
                  ],
                }
              : before.data;
        const after = await api<Annotation>(
          `attachments/${before.attachment_id}/annotations/${before.id}`,
          {
            method: "PUT",
            body: JSON.stringify({
              id: before.id,
              version: before.version,
              mutation_id: crypto.randomUUID(),
              data,
              shared: restore
                ? desired.shared
                : action === "share"
                  ? true
                  : action === "private"
                    ? false
                    : before.shared,
              deleted: restore ? desired.deleted : action === "delete",
            }),
          },
        );
        changes.push({ before, after });
        succeeded++;
      } catch (e) {
        failures.push(`${before.id.slice(0, 8)}: ${(e as Error).message}`);
      }
    }
    setUndo(restore ? [] : changes);
    setMessage(
      `${succeeded} ${restore ? "restored" : "updated"}.${failures.length ? ` ${failures.length} failed: ${failures.join("; ")}` : ""}`,
    );
    setBusy(false);
    onRefresh();
    if (!failures.length) onClear();
  };
  if (!marks.length && !undo.length && !message) return null;
  return (
    <section
      className="pdf-bulk-actions"
      aria-label="Selected annotation actions"
    >
      {!!marks.length && (
        <>
          <span>{marks.length} selected</span>
          <select
            aria-label="Bulk annotation action"
            value={action}
            disabled={busy}
            onChange={(e) => {
              setAction(e.target.value);
              setValue(e.target.value === "color" ? "yellow" : "");
            }}
          >
            <option value="color">Recolor</option>
            <option value="tag">Add tag</option>
            <option value="share">Share</option>
            <option value="private">Make private</option>
            <option value="delete">Remove</option>
          </select>
          {action === "color" ? (
            <select
              aria-label="Bulk annotation color"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            >
              {["yellow", "green", "blue", "pink"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          ) : action === "tag" ? (
            <input
              aria-label="Bulk annotation tag"
              value={value}
              maxLength={40}
              onChange={(e) => setValue(e.target.value)}
            />
          ) : null}
          <button
            disabled={
              busy ||
              !navigator.onLine ||
              (action === "tag" && !value.trim()) ||
              marks.length > 100
            }
            onClick={() => void apply()}
          >
            Apply
          </button>
          <button disabled={busy} onClick={onClear}>
            Clear
          </button>
        </>
      )}
      {!!undo.length && (
        <button
          disabled={busy || !navigator.onLine}
          onClick={() => void apply(true)}
        >
          Undo {undo.length} changes
        </button>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
