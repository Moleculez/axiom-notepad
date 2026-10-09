"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import { Button, HelpText, TextInput, NativeSelect } from "../ui/controls";
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
  useInterfaceLocale();
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
      title={uiText("Link annotation to a task")}
      subtitle={`Page ${annotation.data.page} · ${annotation.shared ? "Shared annotation" : "Private annotation"}`}
      onClose={onClose}
    >
      <HelpText>
        <I18nText id="The link opens this exact PDF version and annotation. Private annotations remain private. No quotation or annotation text is copied to the task." />
      </HelpText>
      <ErrorNotice message={error || data.error} retry={data.reload} />
      {result ? (
        <p role="status">
          <I18nText id="Linked successfully." />{" "}
          <a
            href={`/workbench/workspaces/${result.spaceId}/planning?task=${result.taskId}`}
          >
            <I18nText id="Open task" />
          </a>
        </p>
      ) : (
        <>
          <label>
            <I18nText id="Find a task in this workspace" />
            <TextInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label>
            <I18nText id="Task" />
            <NativeSelect
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">
                <I18nText id="Create a new task" />
              </option>
              {data.data?.items.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </NativeSelect>
          </label>
          {!selected && (
            <label>
              <I18nText id="New task title" />
              <TextInput
                maxLength={300}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={uiText("Describe the follow-up")}
              />
              <small>
                <I18nText id="The title will be visible to workspace members." />
              </small>
            </label>
          )}
          <DialogFooter>
            <Button
              data-dialog-cancel
              className="button secondary"
              onClick={onClose}
            >
              <I18nText id="Cancel" />
            </Button>
            <Button
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
                ? uiText("Linking…")
                : selected
                  ? "Link to task"
                  : "Create and link"}
            </Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}
