"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import { useEffect, useState } from "react";
import { Button, NativeSelect, TextInput, HelpText } from "../ui/controls";
import Dialog, { DialogFooter } from "../Dialog";
import { PlanningEntityPicker } from "./PlanningFields";
import { api } from "../../lib/client";
import { mutate, useAction, ErrorNotice, useWorkspace } from "./ui";
export default function ResearchTaskHandoff({
  spaceId,
  endpoint,
  anchor,
  title,
  onClose,
}: {
  spaceId: string;
  endpoint: string;
  anchor: { snapshotId?: string; referenceEventId?: string };
  title: string;
  onClose: () => void;
}) {
  useInterfaceLocale();
  const [mode, setMode] = useState("new"),
    [name, setName] = useState(`Review ${title}`.slice(0, 300)),
    [taskId, setTaskId] = useState("");
  const action = useAction(),
    { refresh, notify } = useWorkspace();
  const [selected, setSelected] = useState<{
      id: string;
      version: number;
    } | null>(null),
    [selectionError, setSelectionError] = useState(""),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setSelected(null);
    setSelectionError("");
    if (mode !== "existing" || !taskId) return;
    const controller = new AbortController();
    void api<{ version: number }>(`tasks/${taskId}`, {
      signal: controller.signal,
    })
      .then((task) => {
        if (!controller.signal.aborted)
          setSelected({ id: taskId, version: task.version });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setSelectionError(
            error instanceof Error ? error.message : "Task unavailable.",
          );
      });
    return () => controller.abort();
  }, [mode, taskId, attempt]);
  return (
    <Dialog
      title={uiText("Research follow-up")}
      subtitle={uiText(
        "Link an immutable source to a workspace task. No private quotation or source text is copied.",
      )}
      onClose={() => !action.busy && onClose()}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            if (mode === "existing" && selected?.id !== taskId)
              throw new Error("Refresh the selected task before linking.");
            await mutate(endpoint, {
              ...anchor,
              ...(mode === "existing" && selected
                ? { taskId, taskVersion: selected.version }
                : { title: name }),
            });
            refresh();
            notify("Research source linked to the task.");
            onClose();
          });
        }}
      >
        <label>
          <I18nText id="Destination" />
          <NativeSelect
            value={mode}
            onChange={(event) => setMode(event.target.value)}
          >
            <option value="new">
              <I18nText id="Create a follow-up task" />
            </option>
            <option value="existing">
              <I18nText id="Link to an existing task" />
            </option>
          </NativeSelect>
        </label>
        {mode === "new" ? (
          <label>
            <I18nText id="Task title" />
            <TextInput
              required
              maxLength={300}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        ) : (
          <label>
            <I18nText id="Task" />
            <PlanningEntityPicker
              spaceId={spaceId}
              kind="task"
              value={taskId}
              onChange={(id) => setTaskId(String(id))}
              label={uiText("Follow-up task")}
            />
          </label>
        )}
        <HelpText>
          <I18nText id="The link retains the selected milestone or reference event. If the source is removed or access changes, it becomes unavailable rather than switching to the latest version." />
        </HelpText>
        {mode === "existing" && taskId && (
          <HelpText>
            {selected?.id === taskId
              ? `Selected task version ${selected.version}. If it changes, refresh before retrying.`
              : uiText("Checking selected task…")}
            <Button
              type="button"
              variant="ghost"
              disabled={action.busy}
              onClick={() => setAttempt((n) => n + 1)}
            >
              <I18nText id="Refresh task" />
            </Button>
          </HelpText>
        )}
        <ErrorNotice message={selectionError || action.error} />
        <DialogFooter>
          <Button
            data-dialog-cancel
            type="button"
            variant="secondary"
            disabled={action.busy}
            onClick={onClose}
          >
            <I18nText id="Cancel" />
          </Button>
          <Button
            type="submit"
            variant="primary"
            pending={action.busy}
            disabled={
              mode === "new" ? !name.trim() : selected?.id !== taskId || !taskId
            }
          >
            <I18nText id="Link source" />
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
