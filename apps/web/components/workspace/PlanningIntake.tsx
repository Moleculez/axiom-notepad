"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  ListFilter,
  Plus,
  RefreshCw,
} from "lucide-react";
import { z } from "zod";
import { intakeInputSchema } from "@axiom/shared/planning-suite";
import {
  intakeStatusLabels,
  type IntakeDetail,
  type IntakePage,
  type IntakeQuery,
  type IntakeRequest,
} from "@axiom/shared/planning-intake";
import type { Space } from "@axiom/shared/workspace";
import {
  ActionRow,
  Button,
  Checkbox,
  Field,
  HelpText,
  NativeSelect,
  Notice,
  SearchField,
  TextInput,
  TextArea,
} from "../ui/controls";
import Dialog, { DialogBody, DialogFooter } from "../Dialog";
import DraftGuard from "./DraftGuard";
import { PersonPicker, closePlanningDraft } from "./PlanningFields";
import { PlanningHistory } from "./PlanningSuitePanels";
import {
  Empty,
  ErrorNotice,
  Loading,
  mutate,
  useAction,
  useData,
  useWorkspace,
  WorkspaceLink,
} from "./ui";

const Markdown = dynamic(() => import("./PlanningMarkdown"), {
  loading: () => <Loading label="Opening editor…" />,
});
type IntakeInput = z.infer<typeof intakeInputSchema>;
const requestTemplates: Record<
  IntakeInput["kind"],
  { label: string; body: string }
> = {
  research: {
    label: "Research request",
    body: "## Question\n\n## Context and evidence\n\n## Expected outcome\n",
  },
  experiment: {
    label: "Experiment",
    body: "## Hypothesis\n\n## Method and controls\n\n## Resources and safety\n\n## Acceptance criteria\n",
  },
  "paper-review": {
    label: "Paper review",
    body: "## Paper / DOI\n\n## Review scope\n\n## Questions and deliverable\n",
  },
  "data-request": {
    label: "Data request",
    body: "## Dataset and provenance\n\n## Access and privacy constraints\n\n## Requested format\n\n## Intended use\n",
  },
};
type Filters = Pick<IntakeQuery, "filter" | "q" | "sort" | "mine" | "limit"> & {
  kind: IntakeInput["kind"] | "";
};
const defaults: Filters = {
  filter: "open",
  q: "",
  kind: "",
  mine: "0",
  sort: "newest",
  limit: 30,
};

export function PlanningIntake({
  space,
  people,
  online,
}: {
  space: Space;
  people: Array<{ id: string; name: string }>;
  online: boolean;
}) {
  const { revision, refresh, session, notify } = useWorkspace();
  const [filters, setFilters] = useState(defaults),
    [search, setSearch] = useState("");
  // Positions, not offset page numbers: concurrent submissions cannot shift older pages.
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [opening, setOpening] = useState<{
    id: string;
    intent: "details" | "review";
  } | null>(null);
  const [creating, setCreating] = useState(false),
    [filtering, setFiltering] = useState(false),
    [history, setHistory] = useState<string | null>(null);
  const action = useAction();
  const set = (patch: Partial<Filters>) => {
    setFilters((old) => ({ ...old, ...patch }));
    setCursors([null]);
  };
  useEffect(() => {
    const timer = setTimeout(() => {
      if (search.trim() !== filters.q) {
        setFilters((old) => ({ ...old, q: search.trim() }));
        setCursors([null]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [search, filters.q]);
  const params = new URLSearchParams({
    ...filters,
    limit: String(filters.limit),
  });
  if (!filters.kind) params.delete("kind");
  const cursor = cursors.at(-1);
  if (cursor) params.set("cursor", cursor);
  const data = useData<IntakePage>(
    `spaces/${space.id}/intake?${params}`,
    revision,
  );
  const canSubmit =
    online &&
    space.effective_status === "active" &&
    ["editor", "commenter"].includes(space.role);
  const canReview = data.data?.canReview && canSubmit;
  const counts = data.data?.statusCounts;
  const countLabel = (statuses: Array<keyof typeof intakeStatusLabels>) =>
    counts
      ? ` (${statuses.reduce((total, status) => total + counts[status], 0).toLocaleString()})`
      : "";
  const rows = data.data?.items ?? [],
    filtered =
      filters.q ||
      filters.kind ||
      filters.mine === "1" ||
      filters.sort !== "newest" ||
      filters.filter !== "open";
  const extraFilters =
    Number(!!filters.kind) +
    Number(filters.mine === "1") +
    Number(filters.sort !== "newest");
  const reset = () => {
    setSearch("");
    setFilters(defaults);
    setCursors([null]);
  };
  const recheck = () => {
    setCursors([null]);
    data.reload();
  };
  const saved = () => {
    setOpening(null);
    setCreating(false);
    setCursors([null]);
    refresh();
  };
  return (
    <section
      className="planning-suite-panel planning-intake"
      aria-label="Research intake"
    >
      <header>
        <div>
          <h2>Intake</h2>
          <HelpText>
            Workspace requests and decision history. Accepting creates exactly
            one task.
          </HelpText>
        </div>
        <Button
          variant="primary"
          disabled={!canSubmit}
          onClick={() => setCreating(true)}
        >
          <Plus size={16} />
          Submit request
        </Button>
      </header>
      <div
        className="planning-intake-filters"
        role="search"
        aria-label="Filter research requests"
      >
        <SearchField
          aria-label="Search requests"
          placeholder="Search requests and review notes…"
          maxLength={200}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => {
            setSearch("");
            set({ q: "" });
          }}
        />
        <NativeSelect
          aria-label="Request filter"
          value={filters.filter}
          onChange={(e) => set({ filter: e.target.value as Filters["filter"] })}
        >
          <option value="open">
            Open requests{countLabel(["pending", "needs-changes"])}
          </option>
          <option value="history">
            Decision history{countLabel(["accepted", "rejected", "withdrawn"])}
          </option>
          <option value="all">
            All requests
            {countLabel([
              "pending",
              "needs-changes",
              "accepted",
              "rejected",
              "withdrawn",
            ])}
          </option>
          {Object.entries(intakeStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
              {countLabel([value as keyof typeof intakeStatusLabels])}
            </option>
          ))}
        </NativeSelect>
        <Button
          variant={extraFilters ? "secondary" : "ghost"}
          aria-haspopup="dialog"
          onClick={() => setFiltering(true)}
        >
          <ListFilter size={16} />
          Filters{extraFilters ? ` · ${extraFilters}` : ""}
        </Button>
      </div>
      <div className="planning-intake-summary">
        <HelpText role="status" aria-live="polite">
          {data.data
            ? `${data.data.total.toLocaleString()} matching ${data.data.total === 1 ? "request" : "requests"}`
            : data.loading
              ? "Finding requests…"
              : "Requests unavailable"}
          {data.loading && data.data ? " · Updating…" : ""}
        </HelpText>
        <ActionRow>
          {filtered && (
            <Button size="compact" variant="ghost" onClick={reset}>
              Reset filters
            </Button>
          )}
          <Button
            size="compact"
            variant="ghost"
            disabled={data.loading}
            onClick={recheck}
          >
            <RefreshCw size={14} />
            Refresh
          </Button>
        </ActionRow>
      </div>
      <ErrorNotice
        message={data.error || action.error}
        retry={cursor ? recheck : data.reload}
      />
      <div className="planning-request-list" aria-busy={data.loading}>
        {data.loading && !data.data ? (
          <Loading />
        ) : data.error && !data.data ? null : !rows.length ? (
          <Empty
            title={
              cursor
                ? "No requests remain on this page"
                : "No matching requests"
            }
          >
            {cursor
              ? "Requests may have been reviewed. Refresh to return to the first page."
              : filtered
                ? "Try another status or type, or clear the search."
                : "Capture a question, experiment, review or data need before turning it into work."}
          </Empty>
        ) : (
          rows.map((r) => (
            <article key={r.id}>
              <div>
                <Button
                  size="compact"
                  variant="ghost"
                  className="planning-request-title"
                  onClick={() => setOpening({ id: r.id, intent: "details" })}
                >
                  {r.title}
                </Button>
                <div className="planning-request-metadata">
                  <span
                    className="planning-request-state"
                    data-status={r.status}
                  >
                    {intakeStatusLabels[r.status]}
                  </span>
                  <span>{requestTemplates[r.kind].label}</span>
                  <span>{r.author_name ?? "Former member"}</span>
                  <time
                    dateTime={r.created_at}
                    title={new Date(r.created_at).toLocaleString()}
                  >
                    {new Date(r.created_at).toLocaleDateString()}
                  </time>
                  {r.due_on && <span>Desired {r.due_on.slice(0, 10)}</span>}
                  {r.priority !== "normal" && (
                    <span>{r.priority} priority</span>
                  )}
                </div>
                {r.decision_note && (
                  <p className="planning-request-decision">
                    {r.reviewer_name && <strong>{r.reviewer_name}: </strong>}
                    {r.decision_note}
                  </p>
                )}
                {r.task_id && (
                  <WorkspaceLink
                    to={`/workspaces/${space.id}/planning?task=${r.task_id}`}
                  >
                    Open accepted task ↗
                  </WorkspaceLink>
                )}
              </div>
              <ActionRow>
                {canReview && r.status === "pending" && (
                  <Button
                    size="compact"
                    onClick={() => setOpening({ id: r.id, intent: "review" })}
                  >
                    Review
                  </Button>
                )}
                {r.created_by === session.user.id &&
                  ["pending", "needs-changes"].includes(r.status) && (
                    <Button
                      size="compact"
                      variant="ghost"
                      disabled={!canSubmit || action.busy}
                      onClick={() =>
                        void action.run(async () => {
                          await mutate(
                            `spaces/${space.id}/intake/${r.id}`,
                            { version: r.version, decision: "withdrawn" },
                            "PATCH",
                          );
                          saved();
                          notify("Request withdrawn; history retained.");
                        })
                      }
                    >
                      Withdraw
                    </Button>
                  )}
                <Button
                  size="compact"
                  variant="ghost"
                  onClick={() => setHistory(r.id)}
                >
                  <Clock size={14} />
                  History
                </Button>
              </ActionRow>
            </article>
          ))
        )}
      </div>
      <nav className="planning-intake-pagination" aria-label="Request pages">
        <HelpText>
          Page {cursors.length} · {rows.length} shown
          {cursor ? " · New submissions appear after Refresh" : ""}
        </HelpText>
        <NativeSelect
          aria-label="Requests per page"
          value={filters.limit}
          onChange={(e) => set({ limit: Number(e.target.value) })}
        >
          {[15, 30, 60, 100].map((limit) => (
            <option key={limit} value={limit}>
              {limit} per page
            </option>
          ))}
        </NativeSelect>
        <ActionRow>
          <Button
            size="compact"
            disabled={data.loading || cursors.length === 1}
            onClick={() => setCursors((old) => old.slice(0, -1))}
          >
            <ArrowLeft size={14} />
            Previous
          </Button>
          <Button
            size="compact"
            disabled={data.loading || !data.data?.nextCursor}
            onClick={() => {
              if (data.data?.nextCursor)
                setCursors((old) => [...old, data.data!.nextCursor]);
            }}
          >
            Next
            <ArrowRight size={14} />
          </Button>
        </ActionRow>
      </nav>
      {creating && (
        <IntakeEditor
          spaceId={space.id}
          request={null}
          readOnly={!canSubmit}
          onClose={() => setCreating(false)}
          onSaved={() => {
            saved();
            notify("Request submitted.");
          }}
        />
      )}
      {filtering && (
        <IntakeFilters
          filters={filters}
          onClose={() => setFiltering(false)}
          onApply={(next) => {
            set(next);
            setFiltering(false);
          }}
        />
      )}
      {opening && (
        <IntakeDetails
          key={opening.id}
          space={space}
          id={opening.id}
          intent={opening.intent}
          people={people}
          canSubmit={canSubmit}
          onClose={() => setOpening(null)}
          onSaved={saved}
        />
      )}
      {history && (
        <Dialog title="Request history" onClose={() => setHistory(null)}>
          <PlanningHistory spaceId={space.id} id={history} />
          <DialogFooter>
            <Button onClick={() => setHistory(null)}>Done</Button>
          </DialogFooter>
        </Dialog>
      )}
    </section>
  );
}

function IntakeFilters({
  filters,
  onClose,
  onApply,
}: {
  filters: Filters;
  onClose: () => void;
  onApply: (filters: Pick<Filters, "kind" | "sort" | "mine">) => void;
}) {
  const [draft, setDraft] = useState({
    kind: filters.kind,
    sort: filters.sort,
    mine: filters.mine,
  });
  return (
    <Dialog title="Filter research requests" size="compact" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onApply(draft);
        }}
      >
        <DialogBody>
          <div className="planning-suite-form">
            <Field label="Request type">
              <NativeSelect
                value={draft.kind}
                onChange={(e) =>
                  setDraft((old) => ({
                    ...old,
                    kind: e.target.value as Filters["kind"],
                  }))
                }
              >
                <option value="">All types</option>
                {Object.entries(requestTemplates).map(([value, t]) => (
                  <option key={value} value={value}>
                    {t.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Request order">
              <NativeSelect
                value={draft.sort}
                onChange={(e) =>
                  setDraft((old) => ({
                    ...old,
                    sort: e.target.value as Filters["sort"],
                  }))
                }
              >
                <option value="newest">Newest submitted</option>
                <option value="oldest">Oldest submitted</option>
              </NativeSelect>
            </Field>
            <label className="planning-check-label">
              <Checkbox
                checked={draft.mine === "1"}
                onChange={(e) =>
                  setDraft((old) => ({
                    ...old,
                    mine: e.target.checked ? "1" : "0",
                  }))
                }
              />
              My requests only
            </label>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Apply filters
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function IntakeDetails({
  space,
  id,
  intent,
  people,
  canSubmit,
  onClose,
  onSaved,
}: {
  space: Space;
  id: string;
  intent: "details" | "review";
  people: Array<{ id: string; name: string }>;
  canSubmit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { revision, session, notify } = useWorkspace();
  const data = useData<IntakeDetail>(
    `spaces/${space.id}/intake/${id}`,
    revision,
  );
  // Capture source/version once. A peer refresh may invalidate, never replace, a draft.
  const [snapshot, setSnapshot] = useState<IntakeRequest | null>(null);
  useEffect(() => {
    if (data.data) setSnapshot((old) => old ?? data.data!.item);
  }, [data.data]);
  const changed =
    !!snapshot && !!data.data && snapshot.version !== data.data.item.version;
  const unavailable = !!data.error && !data.data;
  const canReview =
    !!data.data?.canReview &&
    canSubmit &&
    !changed &&
    !unavailable &&
    data.data.item.status === "pending";
  const onError = <ErrorNotice message={data.error} retry={data.reload} />;
  const stale = changed ? (
    <Notice tone="warning">
      This request changed while you were viewing it. Your draft is retained.
      Close and reopen it before resubmitting or deciding.
    </Notice>
  ) : null;
  if (!snapshot)
    return (
      <Dialog
        title={
          intent === "review" ? "Review research request" : "Request details"
        }
        onClose={onClose}
      >
        {onError}
        {data.loading && <Loading label="Opening request…" />}
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </Dialog>
    );
  const request = snapshot;
  if (intent === "review")
    return (
      <IntakeReview
        request={request}
        spaceId={space.id}
        people={people}
        enabled={canReview}
        canAccept={space.role === "editor"}
        notice={
          <>
            {onError}
            {stale}
            {!canReview && !changed && !data.error && (
              <Notice tone="warning">
                This request cannot be reviewed now. Check its status, your
                access and the workspace connection.
              </Notice>
            )}
          </>
        }
        onClose={onClose}
        onSaved={(accepted) => {
          onSaved();
          notify(accepted ? "Accepted; a task was created." : "Review saved.");
        }}
      />
    );
  return (
    <IntakeEditor
      request={request}
      spaceId={space.id}
      readOnly={
        !canSubmit ||
        changed ||
        unavailable ||
        request.created_by !== session.user.id ||
        !["pending", "needs-changes"].includes(request.status)
      }
      notice={
        <>
          {onError}
          {stale}
        </>
      }
      onClose={onClose}
      onSaved={() => {
        onSaved();
        notify("Request resubmitted.");
      }}
    />
  );
}

function IntakeReview({
  request,
  spaceId,
  people,
  enabled,
  canAccept,
  notice,
  onClose,
  onSaved,
}: {
  request: IntakeRequest;
  spaceId: string;
  people: Array<{ id: string; name: string }>;
  enabled: boolean;
  canAccept: boolean;
  notice: React.ReactNode;
  onClose: () => void;
  onSaved: (accepted: boolean) => void;
}) {
  const [initialDecision] = useState(canAccept ? "accepted" : "needs-changes");
  const [decision, setDecision] = useState(initialDecision),
    [note, setNote] = useState(""),
    [assignee, setAssignee] = useState("");
  const action = useAction(),
    dirty = !!note || !!assignee || decision !== initialDecision;
  const close = () =>
    closePlanningDraft(dirty, action.busy, onClose, "Unsaved review");
  return (
    <Dialog
      title="Review research request"
      subtitle={request.title}
      onClose={close}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!enabled || (decision === "accepted" && !canAccept)) return;
          void action.run(async () => {
            await mutate(
              `spaces/${spaceId}/intake/${request.id}`,
              {
                version: request.version,
                decision,
                note,
                task: { assigneeId: assignee || null },
              },
              "PATCH",
            );
            onSaved(decision === "accepted");
          });
        }}
      >
        <DraftGuard dirty={dirty} title="Unsaved review" />
        <DialogBody>
          {notice}
          <ErrorNotice message={action.error} />
          <Markdown
            initial={request.body}
            onChange={() => {}}
            label="Request contents"
            readOnly
            preview
          />
          <fieldset
            disabled={!enabled || action.busy}
            className="planning-suite-form"
          >
            <Field label="Decision">
              <NativeSelect
                value={decision}
                onChange={(e) => setDecision(e.target.value)}
              >
                <option value="accepted" disabled={!canAccept}>
                  Accept and create task
                </option>
                <option value="needs-changes">Ask for changes</option>
                <option value="rejected">Reject</option>
              </NativeSelect>
            </Field>
            {!canAccept && (
              <HelpText>
                Accepting and creating a task requires workspace editing access.
                You can still ask for changes or reject the request.
              </HelpText>
            )}
            {decision === "accepted" && (
              <Field label="Task assignee">
                <PersonPicker
                  label="Accepted task assignee"
                  people={people}
                  value={assignee}
                  onChange={setAssignee}
                />
              </Field>
            )}
            <Field label="Review note">
              <TextArea
                rows={3}
                maxLength={4000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                required={decision !== "accepted"}
              />
            </Field>
          </fieldset>
        </DialogBody>
        <DialogFooter>
          <Button type="button" disabled={action.busy} onClick={close}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            pending={action.busy}
            disabled={
              !enabled ||
              (decision === "accepted" && !canAccept) ||
              (decision !== "accepted" && !note.trim())
            }
          >
            <Check size={15} />
            Save decision
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function IntakeEditor({
  spaceId,
  request,
  readOnly,
  notice,
  onClose,
  onSaved,
}: {
  spaceId: string;
  request: IntakeRequest | null;
  readOnly: boolean;
  notice?: React.ReactNode;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [initial] = useState<IntakeInput>(() =>
    request
      ? {
          title: request.title,
          kind: request.kind,
          body: request.body,
          dueOn: request.due_on?.slice(0, 10) ?? null,
          priority: request.priority,
        }
      : {
          title: "",
          kind: "research",
          body: requestTemplates.research.body,
          dueOn: null,
          priority: "normal",
        },
  );
  const [draft, setDraft] = useState(initial),
    [editorKey, setEditorKey] = useState(0),
    action = useAction();
  const set = (patch: Partial<IntakeInput>) =>
    setDraft((old) => ({ ...old, ...patch }));
  const dirty = JSON.stringify(initial) !== JSON.stringify(draft);
  const close = () =>
    closePlanningDraft(dirty, action.busy, onClose, "Unsaved request");
  return (
    <Dialog
      title={request ? "Request details" : "New research request"}
      onClose={close}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (readOnly) return;
          void action.run(async () => {
            await mutate(
              `spaces/${spaceId}/intake${request ? "/" + request.id : ""}`,
              {
                ...intakeInputSchema.parse(draft),
                ...(request ? { version: request.version } : {}),
              },
              request ? "PATCH" : "POST",
            );
            onSaved();
          });
        }}
      >
        <DraftGuard dirty={dirty} title="Unsaved request" />
        <DialogBody>
          {notice}
          <ErrorNotice message={action.error} />
          <div className="planning-suite-form">
            <fieldset
              disabled={readOnly || action.busy}
              className="planning-suite-form"
            >
              <Field label="Template">
                <NativeSelect
                  value={draft.kind}
                  onChange={(e) => {
                    const kind = e.target.value as IntakeInput["kind"];
                    set({
                      kind,
                      ...(!request &&
                      draft.body === requestTemplates[draft.kind].body
                        ? { body: requestTemplates[kind].body }
                        : {}),
                    });
                    setEditorKey((k) => k + 1);
                  }}
                >
                  {Object.entries(requestTemplates).map(([id, t]) => (
                    <option key={id} value={id}>
                      {t.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Request">
                <TextInput
                  autoFocus
                  data-dialog-initial-focus
                  required
                  maxLength={300}
                  value={draft.title}
                  onChange={(e) => set({ title: e.target.value })}
                />
              </Field>
              <div className="planning-field-grid">
                <Field label="Desired date">
                  <TextInput
                    type="date"
                    value={draft.dueOn ?? ""}
                    onChange={(e) => set({ dueOn: e.target.value || null })}
                  />
                </Field>
                <Field label="Priority">
                  <NativeSelect
                    value={draft.priority}
                    onChange={(e) =>
                      set({
                        priority: e.target.value as IntakeInput["priority"],
                      })
                    }
                  >
                    {["low", "normal", "high", "urgent"].map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
            </fieldset>
            <Markdown
              key={editorKey}
              initial={draft.body}
              onChange={(body) => set({ body })}
              readOnly={readOnly || action.busy}
              label="Request contents"
              preview={!!request && readOnly && !dirty}
            />
          </div>
          {request?.decision_note && (
            <Notice tone="info">
              {request.reviewer_name
                ? `${request.reviewer_name}: `
                : "Review: "}
              {request.decision_note}
            </Notice>
          )}
          {request?.task_id && (
            <WorkspaceLink
              to={`/workspaces/${spaceId}/planning?task=${request.task_id}`}
            >
              Open accepted task ↗
            </WorkspaceLink>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" disabled={action.busy} onClick={close}>
            Close
          </Button>
          {!readOnly && (
            <Button
              type="submit"
              variant="primary"
              pending={action.busy}
              disabled={
                (!dirty && request?.status !== "needs-changes") ||
                !draft.title.trim()
              }
            >
              {request ? "Resubmit" : "Submit request"}
            </Button>
          )}
        </DialogFooter>
      </form>
    </Dialog>
  );
}
