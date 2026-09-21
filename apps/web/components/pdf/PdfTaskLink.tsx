"use client";
import { useState } from "react";
import type { Annotation } from "@axiom/shared/research";
import Dialog, { DialogFooter } from "../Dialog";
import { post } from "../../lib/client";
import { ErrorNotice, useData } from "../workspace/ui";
export default function PdfTaskLink({
  annotation,
  spaceId,
  onClose,
}: {
  annotation: Annotation;
  spaceId: string;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState(""),
    [title, setTitle] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<{ taskId: string; spaceId: string } | null>(
      null,
    );
  const data = useData<{
    items: { id: string; title: string; version: number }[];
  }>(`spaces/${spaceId}/tasks?q=${encodeURIComponent(query)}&limit=50`);
  const [mutationId] = useState(() => crypto.randomUUID());
  return (
    <Dialog
      title="Link annotation to a task"
      subtitle={`Page ${annotation.data.page} · ${annotation.shared ? "Shared annotation" : "Private annotation"}`}
      onClose={onClose}
    >
      <p className="ws-note">
        The link opens this exact PDF version and annotation. Private
        annotations remain private. No quotation or annotation text is copied to
        the task.
      </p>
      <ErrorNotice message={error || data.error} retry={data.reload} />
      {result ? (
        <p role="status">
          Linked successfully.{" "}
          <a
            href={`/workbench/workspaces/${result.spaceId}/planning?task=${result.taskId}`}
          >
            Open task
          </a>
        </p>
      ) : (
        <>
          <label>
            Find a task in this workspace
            <input value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <label>
            Task
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Create a new task</option>
              {data.data?.items.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
          {!selected && (
            <label>
              New task title
              <input
                maxLength={300}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Describe the follow-up"
              />
              <small>The title will be visible to workspace members.</small>
            </label>
          )}
          <DialogFooter>
            <button className="button secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={busy || (!selected && !title.trim())}
              onClick={() =>
                void (async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const task = selected
                      ? data.data?.items.find((t) => t.id === selected)
                      : null;
                    if (selected && !task)
                      throw new Error(
                        "Select a currently visible task before linking.",
                      );
                    setResult(
                      await post(
                        `paper-annotations/${annotation.id}/paper-links`,
                        {
                          mutationId,
                          annotationVersion: annotation.version,
                          ...(task
                            ? { taskId: selected, taskVersion: task.version }
                            : { title }),
                        },
                      ),
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                })()
              }
            >
              {busy
                ? "Linking…"
                : selected
                  ? "Link to task"
                  : "Create and link"}
            </button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}
