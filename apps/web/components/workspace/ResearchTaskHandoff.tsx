"use client";
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
      title="Research follow-up"
      subtitle="Link an immutable source to a workspace task. No private quotation or source text is copied."
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
          Destination
          <NativeSelect
            value={mode}
            onChange={(event) => setMode(event.target.value)}
          >
            <option value="new">Create a follow-up task</option>
            <option value="existing">Link to an existing task</option>
          </NativeSelect>
        </label>
        {mode === "new" ? (
          <label>
            Task title
            <TextInput
              required
              maxLength={300}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        ) : (
          <label>
            Task
            <PlanningEntityPicker
              spaceId={spaceId}
              kind="task"
              value={taskId}
              onChange={(id) => setTaskId(String(id))}
              label="Follow-up task"
            />
          </label>
        )}
        <HelpText>
          The link retains the selected milestone or reference event. If the
          source is removed or access changes, it becomes unavailable rather
          than switching to the latest version.
        </HelpText>
        {mode === "existing" && taskId && (
          <HelpText>
            {selected?.id === taskId
              ? `Selected task version ${selected.version}. If it changes, refresh before retrying.`
              : "Checking selected task…"}
            <Button
              type="button"
              variant="ghost"
              disabled={action.busy}
              onClick={() => setAttempt((n) => n + 1)}
            >
              Refresh task
            </Button>
          </HelpText>
        )}
        <ErrorNotice message={selectionError || action.error} />
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            disabled={action.busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            pending={action.busy}
            disabled={
              mode === "new" ? !name.trim() : selected?.id !== taskId || !taskId
            }
          >
            Link source
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
