"use client";
import { useState } from "react";
import { Bookmark, SlidersHorizontal, X } from "lucide-react";
import { z } from "zod";
import {
  planningViewStateSchema,
  type PlanningViewState,
} from "@axiom/shared/planning-suite";
import {
  addDays,
  type PlanningTask,
  type ScheduleChange,
} from "@axiom/shared/planning";
import {
  Button,
  Checkbox,
  Field,
  HelpText,
  IconButton,
  NativeSelect,
  TextInput,
  ActionRow,
} from "../ui/controls";
import { PersonPicker } from "./PlanningFields";
import Dialog from "../Dialog";
import { ErrorNotice, mutate, useAction, useData, useWorkspace } from "./ui";
type SavedView = {
  id: string;
  name: string;
  state: PlanningViewState;
  version: number;
  user_id: string | null;
};
export function planningState(params: URLSearchParams): PlanningViewState {
  return planningViewStateSchema.parse({
    view: params.get("view") ?? "list",
    zoom: params.get("zoom") ?? "week",
    grouping: params.get("grouping") ?? "parent",
    columns: params.get("columns")?.split(",").filter(Boolean) ?? [],
    showDependencies: params.get("dependencies") !== "0",
    showBaseline: params.get("baseline") !== "0",
    showCritical: params.get("critical") !== "0",
    filters: Object.fromEntries(
      [
        "q",
        "status",
        "priority",
        "assignee",
        "milestone",
        "risk",
        "sort",
        "deleted",
      ].flatMap((key) => (params.get(key) ? [[key, params.get(key)]] : [])),
    ),
  });
}
export function viewChanges(
  state: PlanningViewState,
): Record<string, string | null> {
  return {
    ...Object.fromEntries(
      [
        "q",
        "status",
        "priority",
        "assignee",
        "milestone",
        "risk",
        "sort",
        "deleted",
      ].map((key) => [key, null]),
    ),
    ...state.filters,
    view: state.view,
    zoom: state.zoom,
    grouping: state.grouping,
    columns: state.columns.join(",") || null,
    dependencies: state.showDependencies ? null : "0",
    baseline: state.showBaseline ? null : "0",
    critical: state.showCritical ? null : "0",
    task: null,
  };
}
export function PlanningViewActions({
  spaceId,
  canManage,
  params,
  change,
}: {
  spaceId: string;
  canManage: boolean;
  params: URLSearchParams;
  change: (changes: Record<string, string | null>) => void;
}) {
  const { revision, refresh, session, notify } = useWorkspace(),
    data = useData<SavedView[]>(`spaces/${spaceId}/planning-views`, revision),
    action = useAction();
  const [open, setOpen] = useState(false),
    [editing, setEditing] = useState<SavedView | null>(null),
    [name, setName] = useState(""),
    [shared, setShared] = useState(false);
  return (
    <>
      <NativeSelect
        aria-label="Planning presets and saved views"
        value=""
        onChange={(e) => {
          const id = e.target.value;
          if (!id) return;
          const row = data.data?.find((v) => v.id === id);
          if (row) change(viewChanges(row.state));
          else
            change({
              ...viewChanges(planningViewStateSchema.parse({})),
              ...(id === "mine"
                ? { assignee: session.user.id }
                : id === "all"
                  ? {}
                  : { risk: id }),
            });
        }}
      >
        <option value="">Views & presets</option>
        <optgroup label="Presets">
          <option value="all">All work</option>
          <option value="mine">My work</option>
          <option value="upcoming">Upcoming · 7 days</option>
          <option value="blocked">Blocked</option>
          <option value="overdue">Overdue</option>
        </optgroup>
        {!!data.data?.length && (
          <optgroup label="Saved views">
            {data.data.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.user_id === null ? " · workspace" : ""}
              </option>
            ))}
          </optgroup>
        )}
      </NativeSelect>
      <IconButton
        label="Manage saved views"
        onClick={() => {
          setEditing(null);
          setName("");
          setShared(false);
          setOpen(true);
        }}
      >
        <Bookmark size={16} />
      </IconButton>
      {open && (
        <Dialog
          title="Saved planning views"
          subtitle="Save filters, timeline scale, columns and layers. Private views are visible only to you."
          onClose={() => !action.busy && setOpen(false)}
        >
          <ErrorNotice
            message={data.error || action.error}
            retry={data.error ? data.reload : undefined}
          />
          <div className="planning-saved-views">
            {data.data?.map((v) => (
              <div key={v.id}>
                <strong>{v.name}</strong>
                <small>{v.user_id === null ? "Workspace" : "Private"}</small>
                <Button
                  size="compact"
                  variant="ghost"
                  onClick={() => {
                    change(viewChanges(v.state));
                    setOpen(false);
                  }}
                >
                  Open
                </Button>
                {(v.user_id === session.user.id || canManage) && (
                  <Button
                    size="compact"
                    variant="ghost"
                    onClick={() => {
                      setEditing(v);
                      setName(v.name);
                      setShared(v.user_id === null);
                    }}
                  >
                    Edit
                  </Button>
                )}
                {(v.user_id === session.user.id || canManage) && (
                  <IconButton
                    label={`Delete view ${v.name}`}
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        await mutate(
                          `spaces/${spaceId}/planning-views/${v.id}`,
                          { version: v.version },
                          "DELETE",
                        );
                        refresh();
                      })
                    }
                  >
                    <X size={14} />
                  </IconButton>
                )}
              </div>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action.run(async () => {
                await mutate(
                  `spaces/${spaceId}/planning-views${editing ? "/" + editing.id : ""}`,
                  {
                    name,
                    shared,
                    state: planningState(params),
                    ...(editing ? { version: editing.version } : {}),
                  },
                  editing ? "PATCH" : "POST",
                );
                refresh();
                setEditing(null);
                setName("");
                notify("Planning view saved.");
              });
            }}
          >
            <Field label={editing ? "Rename view" : "Save current view"}>
              <TextInput
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            {canManage && (
              <label className="planning-check-label">
                <Checkbox
                  checked={shared}
                  onChange={(e) => setShared(e.target.checked)}
                />
                Share with this workspace
              </label>
            )}
            {editing && (
              <HelpText>
                Saving also replaces this view’s settings with the current view.
              </HelpText>
            )}
            <ActionRow>
              <Button type="submit" variant="primary" disabled={action.busy}>
                {editing ? "Update view" : "Save view"}
              </Button>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </ActionRow>
          </form>
        </Dialog>
      )}
    </>
  );
}

export function PlanningBulkActions({
  spaceId,
  selected,
  people,
  readOnly,
  onClear,
  onSchedule,
}: {
  spaceId: string;
  selected: PlanningTask[];
  people: Array<{ id: string; name: string }>;
  readOnly: boolean;
  onClear: () => void;
  onSchedule: (changes: ScheduleChange[]) => void;
}) {
  const { refresh, notify } = useWorkspace(),
    action = useAction();
  const [open, setOpen] = useState(false),
    [operation, setOperation] = useState("status"),
    [value, setValue] = useState("todo"),
    [shift, setShift] = useState(1);
  if (!selected.length) return null;
  const writable = selected.length <= 1000 && !readOnly,
    dated = selected.filter(
      (t) =>
        t.start_on &&
        t.due_on &&
        !t.deleted_at &&
        !["done", "cancelled"].includes(t.status),
    );
  return (
    <div
      className="planning-selection-bar"
      role="region"
      aria-label="Selected tasks"
    >
      <strong>{selected.length} selected</strong>
      <HelpText>
        {selected.length > 1000
          ? "At most 1,000 tasks per reviewed change."
          : "Versions are checked together; a conflict changes nothing."}
      </HelpText>
      <Button
        variant="ghost"
        disabled={!writable}
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal size={15} />
        Bulk change
      </Button>
      <IconButton label="Clear task selection" onClick={onClear}>
        <X size={15} />
      </IconButton>
      {open && (
        <Dialog
          title={`Update ${selected.length} selected tasks`}
          onClose={() => !action.busy && setOpen(false)}
          subtitle="The operation is all-or-nothing. Current versions and workspace permissions are checked again when saving."
        >
          <ErrorNotice message={action.error} />
          <Field label="Change">
            <NativeSelect
              value={operation}
              onChange={(e) => {
                setOperation(e.target.value);
                setValue(
                  e.target.value === "status"
                    ? "todo"
                    : e.target.value === "priority"
                      ? "normal"
                      : "",
                );
              }}
            >
              <option value="status">Status</option>
              <option value="priority">Priority</option>
              <option value="assigneeId">Assignee</option>
              <option value="labels">Replace labels</option>
              <option value="shift">Shift scheduled tasks</option>
              <option value="trash">Move to Trash</option>
              <option value="restore">Restore</option>
            </NativeSelect>
          </Field>
          {operation === "status" ? (
            <NativeSelect
              aria-label="New status"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            >
              {["todo", "in_progress", "in_review", "done", "cancelled"].map(
                (s) => (
                  <option key={s}>{s}</option>
                ),
              )}
            </NativeSelect>
          ) : operation === "priority" ? (
            <NativeSelect
              aria-label="New priority"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            >
              {["low", "normal", "high", "urgent"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </NativeSelect>
          ) : operation === "assigneeId" ? (
            <PersonPicker
              label="New assignee"
              people={people}
              value={value}
              onChange={setValue}
            />
          ) : operation === "labels" ? (
            <Field
              label="New labels, comma separated"
              hint="Replaces all selected tasks’ labels. Empty clears them."
            >
              <TextInput
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </Field>
          ) : operation === "shift" ? (
            <Field
              label="Shift by calendar days"
              hint={`${dated.length} dated tasks included · ${selected.length - dated.length} unscheduled, completed, cancelled or deleted tasks skipped. A working-calendar proposal and dependent-task review follows.`}
            >
              <TextInput
                type="number"
                min={-365}
                max={365}
                step={1}
                value={shift}
                onChange={(e) => setShift(Number(e.target.value))}
              />
            </Field>
          ) : (
            <HelpText>
              {operation === "trash"
                ? "Selected children are processed first. An unselected live child prevents the entire removal."
                : "Selected parents are restored first. An unavailable parent prevents the entire restore."}
            </HelpText>
          )}
          <ActionRow>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant={operation === "trash" ? "danger" : "primary"}
              disabled={
                action.busy ||
                (operation === "shift" && (!dated.length || !shift))
              }
              onClick={() =>
                void action.run(async () => {
                  if (operation === "shift") {
                    z.number().int().min(-365).max(365).parse(shift);
                    setOpen(false);
                    onSchedule(
                      dated.map((t) => ({
                        id: t.id,
                        version: t.version,
                        startOn: addDays(t.start_on!, shift),
                        dueOn: addDays(t.due_on!, shift),
                      })),
                    );
                    return;
                  }
                  const patch =
                    operation === "trash" || operation === "restore"
                      ? { deleted: operation === "trash" }
                      : operation === "labels"
                        ? {
                            labels: [
                              ...new Set(
                                value
                                  .split(",")
                                  .map((s) => s.trim())
                                  .filter(Boolean),
                              ),
                            ],
                          }
                        : {
                            [operation]:
                              operation === "assigneeId"
                                ? value || null
                                : value,
                          };
                  const result = await mutate<{ count: number }>(
                    `spaces/${spaceId}/tasks-bulk`,
                    {
                      items: selected.map((t) => ({
                        id: t.id,
                        version: t.version,
                      })),
                      patch,
                    },
                  );
                  setOpen(false);
                  onClear();
                  refresh();
                  notify(`${result.count} tasks updated.`);
                })
              }
            >
              {operation === "shift" ? "Review schedule" : "Apply change"}
            </Button>
          </ActionRow>
        </Dialog>
      )}
    </div>
  );
}
