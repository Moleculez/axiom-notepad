"use client";
import {
  Button,
  Checkbox,
  HelpText,
  Notice,
  TextArea,
  TextInput,
  NativeSelect,
} from "../ui/controls";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  FilePlus2,
  FolderPlus,
  ListChecks,
  Pencil,
  ShieldCheck,
  Square,
  Undo2,
} from "lucide-react";
import Dialog from "../Dialog";
import { api, post } from "../../lib/client";
import { ErrorNotice, useData, useWorkspace } from "../workspace/ui";
import {
  selectedActionKeys,
  type WorkspaceChangeSet,
  type ChangeAction,
  type ChangeActionView,
} from "@axiom/shared/productivity";
import type { RevisionContent } from "@axiom/shared/revisions";
import { canvasSchema } from "@axiom/shared/canvas";
import { calendarSchema, type PlanningTask } from "@axiom/shared/planning";
import RevisionDiff from "../revisions/RevisionDiff";
import PlanningGantt from "../workspace/PlanningGantt";

export default function ChangeSetReview({
  id,
  onClose,
  onChange,
}: {
  id: string;
  onClose: () => void;
  onChange?: () => void;
}) {
  const { spaces, refresh, navigate } = useWorkspace();
  const [activeId, setActiveId] = useState(id),
    [value, setValue] = useState<WorkspaceChangeSet | null>(null),
    [keys, setKeys] = useState<string[]>([]),
    [focused, setFocused] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [edited, setEdited] = useState<ChangeAction[] | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [plan, setPlan] = useState(false);
  const alive = useRef(true),
    selectedSignature = keys.join(","),
    reviewedSignature = useRef("");
  const accept = (next: WorkspaceChangeSet) => {
    setValue(next);
    setError("");
    setConfirmed(false);
    onChange?.();
  };
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    setValue(null);
    setEdited(null);
    setConfirmed(false);
    void api<WorkspaceChangeSet>(`assistant/change-sets/${activeId}`, {
      signal: controller.signal,
    })
      .then((next) => {
        if (!alive.current) return;
        setValue(next);
        const selected = next.preview
          ? next.actions.filter((a) => a.selected).map((a) => a.data.key)
          : next.actions.map((a) => a.data.key);
        setKeys(selected);
        setFocused(next.actions[0]?.data.key ?? "");
        reviewedSignature.current = next.preview ? selected.join(",") : "";
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [activeId]);
  const running = value && ["queued", "applying"].includes(value.status);
  useEffect(() => {
    if (!running) return;
    const controller = new AbortController();
    let inFlight = false;
    const timer = setInterval(() => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      void api<WorkspaceChangeSet>(`assistant/change-sets/${activeId}`, {
        signal: controller.signal,
      })
        .then((next) => {
          setValue(next);
          setError("");
          if (!["queued", "applying"].includes(next.status)) {
            refresh();
            onChange?.();
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            setError(e.message);
            if ([401, 403, 404].includes(e.status)) setValue(null);
          }
        })
        .finally(() => {
          inFlight = false;
        });
    }, 1200);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [running, activeId]);
  const run = async (work: () => Promise<WorkspaceChangeSet>) => {
    setBusy(true);
    setError("");
    try {
      const next = await work();
      if (alive.current) accept(next);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const actions = edited ?? value?.actions.map((a) => a.data) ?? [],
    current = value?.actions.find((a) => a.data.key === focused),
    draft = actions.find((a) => a.key === focused);
  const update = (field: string, next: unknown) => {
    setEdited(
      actions.map((a) =>
        a.key === focused
          ? { ...a, payload: { ...a.payload, [field]: next } }
          : a,
      ),
    );
    setConfirmed(false);
  };
  const canApply =
    !!value?.preview &&
    !edited &&
    reviewedSignature.current === selectedSignature &&
    Date.parse(value.preview.expiresAt) > Date.now() &&
    value.status === "draft";
  return (
    <Dialog
      wide
      title="Review workspace changes"
      subtitle={
        value
          ? `${value.title} · ${value.status} · Nothing applies without your approval`
          : "Loading private draft…"
      }
      className="change-set-dialog"
      onClose={onClose}
    >
      <ErrorNotice message={error || value?.error || ""} />
      {value && (
        <>
          <div className="change-set-summary">
            <ShieldCheck size={17} />
            <span>
              {keys.length} of {value.actions.length} actions ·{" "}
              {value.space_ids
                .map((s) => spaces.find((v) => v.id === s)?.name ?? "Workspace")
                .join(", ")}
            </span>
            <Button className="button ghost" onClick={() => setPlan(!plan)}>
              {plan ? "Action details" : "Plan preview"}
            </Button>
          </div>
          <div className="change-set-layout">
            <nav className="change-set-list" aria-label="Proposed actions">
              {value.actions.map((a) => {
                const Icon =
                  a.data.action === "folder_create"
                    ? FolderPlus
                    : a.data.action === "file_create"
                      ? FilePlus2
                      : a.data.action.includes("task")
                        ? ListChecks
                        : Pencil;
                return (
                  <div
                    className={focused === a.data.key ? "is-active" : ""}
                    key={a.id}
                  >
                    <Checkbox
                      aria-label={`Include ${a.data.title}`}
                      checked={keys.includes(a.data.key)}
                      disabled={busy || value.status !== "draft"}
                      onChange={(e) => {
                        let next = e.target.checked
                          ? selectedActionKeys(actions, [...keys, a.data.key])
                          : keys.filter(
                              (key) =>
                                !selectedActionKeys(actions, [key]).includes(
                                  a.data.key,
                                ),
                            );
                        next = selectedActionKeys(actions, next);
                        setKeys(next);
                        setConfirmed(false);
                      }}
                    />
                    <button
                      aria-current={focused === a.data.key ? "true" : undefined}
                      onClick={() => {
                        setFocused(a.data.key);
                        setPlan(false);
                      }}
                    >
                      <Icon size={16} />
                      <span>
                        {a.data.title}
                        <small>
                          {a.state === "pending"
                            ? a.data.action.replaceAll("_", " ")
                            : a.state}
                        </small>
                      </span>
                      {a.state === "complete" && <Check size={14} />}
                    </button>
                  </div>
                );
              })}
            </nav>
            <section className="change-set-detail" aria-label="Action details">
              {plan ? (
                <DraftPlan
                  actions={value.actions.filter((a) =>
                    keys.includes(a.data.key),
                  )}
                  spaceId={draft?.spaceId ?? value.space_ids[0]}
                />
              ) : (
                current &&
                draft && (
                  <>
                    <h3>{draft.title}</h3>
                    <HelpText>
                      {draft.explanation ||
                        "Review the exact destination and content before applying."}
                    </HelpText>
                    {!!draft.dependsOn.length && (
                      <HelpText>
                        Requires: {draft.dependsOn.join(", ")}
                      </HelpText>
                    )}
                    <ErrorNotice message={current.error ?? ""} />
                    <ActionPreview action={current} draft={current.data} />
                    {value.status === "draft" && (
                      <details className="change-set-edit">
                        <summary>Edit draft fields</summary>
                        <ActionFields
                          action={draft}
                          actions={actions}
                          onChange={update}
                        />
                        {edited && (
                          <Notice tone="warning">
                            Save draft edits to refresh the preview. Approval is
                            disabled until you review the updated changes.
                          </Notice>
                        )}
                      </details>
                    )}
                    {current.result && (
                      <div className="change-set-result">
                        <Check size={15} />
                        <span>Applied successfully</span>
                        <Button
                          className="button ghost"
                          onClick={() =>
                            navigate(
                              current.data.action.includes("task") ||
                                current.data.action.includes("milestone") ||
                                current.data.action.includes("schedule")
                                ? `/workspaces/${current.data.spaceId}/planning`
                                : current.data.action === "folder_create"
                                  ? `/workspaces/${current.data.spaceId}/files?folder=${current.result!.id}`
                                  : `/notes/${current.result!.noteId ?? current.result!.id ?? current.data.targetId}`,
                            )
                          }
                        >
                          Open result
                        </Button>
                      </div>
                    )}
                    {current.undoable && (
                      <Button
                        className="button secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const next: WorkspaceChangeSet = await post(
                              `assistant/change-sets/${value.id}/undo`,
                              { key: current.data.key },
                            );
                            setActiveId(next.id);
                            return next;
                          })
                        }
                      >
                        <Undo2 size={14} />
                        Review undo
                      </Button>
                    )}
                    {!current.undoable && current.state === "complete" && (
                      <Notice tone="warning">
                        Automatic Undo is not available for this action. Use the
                        file history, trash or management controls if needed.
                      </Notice>
                    )}
                    <details className="change-set-exact">
                      <summary>Exact action and receipt</summary>
                      <pre>
                        {JSON.stringify(
                          {
                            action: current.prepared ?? draft,
                            result: current.result,
                          },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  </>
                )
              )}
            </section>
          </div>
        </>
      )}
      <div className="dialog-footer">
        {value?.status === "draft" && (
          <>
            <label className="assistant-consent">
              <Checkbox
                checked={confirmed}
                disabled={!canApply || busy}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I approve these exact changes and their destinations.
            </label>
            {edited && (
              <Button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const next = await api<WorkspaceChangeSet>(
                      `assistant/change-sets/${activeId}`,
                      {
                        method: "PATCH",
                        body: JSON.stringify({
                          version: value.version,
                          actions: edited,
                        }),
                      },
                    );
                    setEdited(null);
                    reviewedSignature.current = "";
                    return next;
                  })
                }
              >
                Save draft edits
              </Button>
            )}
            <Button
              className="button secondary"
              disabled={busy || !!edited || !keys.length}
              onClick={() =>
                void run(async () => {
                  const next: WorkspaceChangeSet = await post(
                    `assistant/change-sets/${activeId}/preview`,
                    { version: value.version, keys },
                  );
                  const selected = next.actions
                    .filter((a) => a.selected)
                    .map((a) => a.data.key);
                  setKeys(selected);
                  reviewedSignature.current = selected.join(",");
                  return next;
                })
              }
            >
              Prepare review
            </Button>
            <Button
              className="button primary"
              disabled={busy || !canApply || !confirmed}
              onClick={() =>
                void run(() =>
                  post(`assistant/change-sets/${activeId}/apply`, {
                    fingerprint: value.preview!.fingerprint,
                    consent: true,
                  }),
                )
              }
            >
              Approve & apply
            </Button>
          </>
        )}
        {value && ["draft", "queued", "applying"].includes(value.status) && (
          <Button
            className="button ghost"
            disabled={busy}
            onClick={() =>
              void run(() =>
                post(`assistant/change-sets/${activeId}/cancel`, {}),
              )
            }
          >
            <Square size={13} />
            {running ? "Stop remaining actions" : "Dismiss"}
          </Button>
        )}
        <Button className="button secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Dialog>
  );
}
function ActionFields({
  action,
  actions,
  onChange,
}: {
  action: ChangeAction;
  actions: ChangeAction[];
  onChange: (key: string, value: unknown) => void;
}) {
  const p = action.payload,
    task = action.action.includes("task"),
    file = ["file_create", "folder_create", "file_update"].includes(
      action.action,
    );
  const folders = useData<{ items: { id: string; name: string }[] }>(
    file
      ? `resources?space=${action.spaceId}&view=all&kind=folder&limit=100`
      : null,
  );
  const members = useData<{ id: string; name: string }[]>(
    task ? `spaces/${action.spaceId}/planning-members` : null,
  );
  return (
    <div className="change-set-fields">
      {["name", "title", "description", "body", "source"]
        .filter((key) => typeof p[key] === "string")
        .map((key) => (
          <label key={key}>
            <span>
              {key === "source"
                ? "Proposed content"
                : key[0].toUpperCase() + key.slice(1)}
            </span>
            {["source", "body", "description"].includes(key) ? (
              <TextArea
                aria-label={`Proposed ${key}`}
                rows={key === "source" ? 8 : 3}
                value={String(p[key])}
                onChange={(e) => onChange(key, e.target.value)}
              />
            ) : (
              <TextInput
                aria-label={`Proposed ${key}`}
                value={String(p[key])}
                onChange={(e) => onChange(key, e.target.value)}
              />
            )}
          </label>
        ))}
      {file && (
        <label>
          <span>Destination folder</span>
          <NativeSelect
            aria-label="Destination folder"
            value={String(p.parentId ?? "")}
            onChange={(e) => onChange("parentId", e.target.value || null)}
          >
            <option value="">Workspace root</option>
            {folders.data?.items.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
            {actions
              .filter(
                (a) =>
                  a.action === "folder_create" &&
                  a.spaceId === action.spaceId &&
                  a.key !== action.key,
              )
              .map((a) => (
                <option key={a.key} value={`@{${a.key}}`}>
                  {a.payload.name as string} · new folder
                </option>
              ))}
          </NativeSelect>
        </label>
      )}
      {task && (
        <label>
          <span>Assignee</span>
          <NativeSelect
            aria-label="Proposed assignee"
            value={String(p.assigneeId ?? "")}
            onChange={(e) => onChange("assigneeId", e.target.value || null)}
          >
            <option value="">Unassigned</option>
            {members.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </NativeSelect>
        </label>
      )}
      {(action.action === "workspace_task_create" ||
        action.action === "workspace_milestone_create") && (
        <div className="change-set-dates">
          {(task ? ["startOn", "dueOn"] : ["dueOn"]).map((key) => (
            <label key={key}>
              <span>{key === "startOn" ? "Start" : "Due"}</span>
              <TextInput
                aria-label={`Proposed ${key}`}
                type="date"
                value={String(p[key] ?? "")}
                onChange={(e) => onChange(key, e.target.value || null)}
              />
            </label>
          ))}
        </div>
      )}
      {(action.action === "file_update" || task) && (
        <label>
          <span>{file ? "Tags" : "Labels"}</span>
          <TextInput
            aria-label="Proposed labels"
            value={
              Array.isArray(p[file ? "tags" : "labels"])
                ? (p[file ? "tags" : "labels"] as string[]).join(", ")
                : ""
            }
            onChange={(e) =>
              onChange(
                file ? "tags" : "labels",
                e.target.value
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean),
              )
            }
          />
        </label>
      )}
    </div>
  );
}
function revision(
  body: string,
  format: string,
  label: string,
): RevisionContent {
  return {
    id: label,
    title: label,
    label,
    kind: "current",
    format: format as RevisionContent["format"],
    createdAt: "",
    author: null,
    contributors: [],
    generation: null,
    metadataVersion: 1,
    body,
    settings: null,
    preview: null,
    download: null,
    fileVersion: null,
    hash: "",
  };
}
function ActionPreview({
  action,
  draft,
}: {
  action: ChangeActionView;
  draft: ChangeAction;
}) {
  const before = String(action.before?.source ?? ""),
    after = String(
      draft.payload.source ?? action.prepared?.payload?.previewSource ?? "",
    );
  const format =
    action.before?.format ??
    (draft.payload.type === "math"
      ? "latex"
      : draft.payload.type === "canvas"
        ? "canvas"
        : draft.payload.type === "markdown"
          ? "markdown"
          : "text");
  if (draft.action === "document_edit" || draft.action === "file_create") {
    if (format === "canvas") return <CanvasDraft source={after} />;
    return (
      <RevisionDiff
        before={revision(before, format, "Before")}
        after={revision(after, format, "Proposed")}
      />
    );
  }
  if (action.prepared?.schedule)
    return (
      <div className="change-set-schedule">
        <h4>Schedule impact</h4>
        <HelpText>
          Dates are checked against the working calendar, dependencies and
          available capacity. Unknown effort is not treated as zero.
        </HelpText>
        <pre>{JSON.stringify(action.prepared.schedule, null, 2)}</pre>
      </div>
    );
  return null;
}
function CanvasDraft({ source }: { source: string }) {
  let data;
  try {
    data = canvasSchema.parse(JSON.parse(source));
  } catch {
    return <p className="form-error">Canvas source is not valid yet.</p>;
  }
  const nodes = data.nodes,
    minX = Math.min(0, ...nodes.map((n) => n.x)),
    minY = Math.min(0, ...nodes.map((n) => n.y)),
    width = Math.max(400, ...nodes.map((n) => n.x + n.width)) - minX,
    height = Math.max(250, ...nodes.map((n) => n.y + n.height)) - minY;
  return (
    <svg
      className="change-set-canvas"
      role="img"
      aria-label="Proposed Canvas layout"
      viewBox={`${minX - 15} ${minY - 15} ${width + 30} ${height + 30}`}
    >
      {data.edges.map((e) => {
        const a = nodes.find((n) => n.id === e.fromNode),
          b = nodes.find((n) => n.id === e.toNode);
        return a && b ? (
          <line
            key={e.id}
            x1={a.x + a.width / 2}
            y1={a.y + a.height / 2}
            x2={b.x + b.width / 2}
            y2={b.y + b.height / 2}
          />
        ) : null;
      })}
      {nodes.map((n) => (
        <g key={n.id}>
          <rect x={n.x} y={n.y} width={n.width} height={n.height} rx={5} />
          <text x={n.x + 12} y={n.y + 25}>
            {(n.title || (n.type === "text" ? n.text : n.type)).slice(0, 48)}
          </text>
        </g>
      ))}
    </svg>
  );
}
function DraftPlan({
  actions,
  spaceId,
}: {
  actions: ChangeActionView[];
  spaceId: string;
}) {
  const settings = useData<{ calendar: unknown }>(
      `spaces/${spaceId}/planning-settings`,
    ),
    [zoom, setZoom] = useState("week");
  const ids = Object.fromEntries(actions.map((a) => [a.data.key, a.entity_id]));
  const resolve = (v: unknown) =>
    typeof v === "string"
      ? v.replace(/@\{([^}]+)\}/g, (_, key) => ids[key] ?? key)
      : v;
  const tasks = actions
    .filter((a) => a.data.action.includes("task") && a.data.spaceId === spaceId)
    .map((a) => {
      const p = a.data.payload,
        b = a.before ?? {};
      return {
        ...b,
        id: a.data.targetId ?? a.entity_id,
        space_id: spaceId,
        title: p.title ?? b.title ?? a.data.title,
        body: p.body ?? b.body ?? "",
        status: p.status ?? b.status ?? "todo",
        priority: p.priority ?? b.priority ?? "normal",
        parent_id: resolve(p.parentId ?? b.parent_id ?? null),
        start_on: p.startOn ?? b.start_on ?? null,
        due_on: p.dueOn ?? b.due_on ?? null,
        assignee_id: p.assigneeId ?? null,
        estimate_hours: p.estimateHours ?? null,
        dependencies: Array.isArray(p.dependencies)
          ? p.dependencies.map(resolve)
          : [],
        resource_ids: [],
        labels: [],
        position: 0,
        version: b.version ?? 1,
        deleted_at: null,
        note_id: null,
        milestone_id: null,
        created_at: "",
        updated_at: "",
      } as unknown as PlanningTask;
    });
  const milestones = actions
    .filter(
      (a) =>
        a.data.action === "workspace_milestone_create" &&
        a.data.spaceId === spaceId,
    )
    .map((a) => ({
      id: a.entity_id,
      title: String(a.data.payload.title),
      due_on: (a.data.payload.dueOn as string | null) ?? null,
      completed_at: null,
      version: 1,
    }));
  if (!tasks.length && !milestones.length)
    return (
      <HelpText>
        This selection has no task or milestone drafts. Select a planning action
        to preview its workspace.
      </HelpText>
    );
  if (!settings.data)
    return <HelpText>{settings.error || "Loading working calendar…"}</HelpText>;
  return (
    <div className="change-set-gantt">
      <h3>Proposed plan</h3>
      <HelpText>
        Selected task and milestone drafts · unscheduled work stays undated.
      </HelpText>
      <PlanningGantt
        tasks={tasks}
        milestones={milestones}
        calendar={calendarSchema.parse(settings.data.calendar)}
        readOnly
        onOpen={() => {}}
        onSchedule={() => {}}
        zoom={zoom}
        onZoom={setZoom}
      />
    </div>
  );
}
