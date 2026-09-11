"use client";
import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  History,
  ListChecks,
  ExternalLink,
  RefreshCw,
  X,
} from "lucide-react";
import {
  auditChanges,
  auditLabel,
  auditVersionDiff,
  type AuditEvent,
  type AuditPage as AuditResult,
  type OperationSummary,
} from "@axiom/shared/audit";
import { api } from "../../lib/client";
import { FileOperationActivity } from "./FileOperations";
import { TrashOperationDialog } from "./TrashPage";
import {
  Empty,
  go,
  ErrorNotice,
  Loading,
  PageHeading,
  useAction,
  useData,
  useLocation,
  useWorkspace,
  WorkspaceLink,
} from "./ui";

export default function AuditPage({
  spaceId,
  embedded = false,
}: {
  spaceId?: string;
  embedded?: boolean;
}) {
  const { revision, spaces, navigate, refresh } = useWorkspace(),
    { params } = useLocation();
  const [localFilters, setLocalFilters] = useState<Record<string, string>>({}),
    [cursor, setCursor] = useState<string | null>(null),
    [previous, setPrevious] = useState<(string | null)[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [tick, setTick] = useState(0),
    [operationOffset, setOperationOffset] = useState(0),
    [status, setStatus] = useState("");
  const operations = !embedded && params.get("view") === "operations",
    operationId = params.get("operation"),
    operationKind = params.get("kind");
  // The URL owns standalone filters. This also restores them after hydration,
  // browser navigation and tab switches, without competing state-sync effects.
  const values = embedded ? localFilters : Object.fromEntries(params),
    search = values.q ?? "",
    space = spaceId ?? values.space ?? "",
    actionFilter = values.action ?? "",
    entity = values.entity ?? "",
    actor = values.actor ?? "",
    after = values.after ?? "",
    before = values.before ?? "";
  const updateFilters = (changes: Record<string, string>) => {
    if (embedded) {
      setLocalFilters((current) => ({ ...current, ...changes }));
      return;
    }
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    go(`/audit${next.size ? `?${next}` : ""}`, true);
  };
  const scopeDetails = useData<{ space: { id: string; name: string } }>(
    space && !spaces.some((s) => s.id === space) ? `spaces/${space}` : null,
    revision,
  );
  const filterKey = JSON.stringify([
    search,
    space,
    actionFilter,
    entity,
    actor,
    after,
    before,
  ]);
  useEffect(() => {
    setCursor(null);
    setPrevious([]);
    setSelected(null);
  }, [filterKey]);
  const filters = new URLSearchParams({
    q: search,
    ...(space ? { space } : {}),
    ...(actor ? { actor } : {}),
    ...(actionFilter ? { action: actionFilter } : {}),
    ...(entity ? { entity } : {}),
    ...(after ? { after } : {}),
    ...(before ? { before } : {}),
  });
  const data = useData<AuditResult>(
    !operations ? `audit?${filters}${cursor ? `&cursor=${cursor}` : ""}` : null,
    revision + tick,
  );
  const detail = useData<AuditEvent>(
    selected ? `audit/${selected}` : null,
    revision + tick,
  );
  const jobs = useData<{
    items: OperationSummary[];
    nextOffset: number | null;
  }>(
    operations
      ? `audit/operations?offset=${operationOffset}&status=${status}`
      : null,
    revision + tick,
  );
  useEffect(() => setOperationOffset(0), [status]);
  const action = useAction();
  useEffect(() => {
    if (!operations) return;
    const timer = setInterval(() => setTick((n) => n + 1), 3000);
    return () => clearInterval(timer);
  }, [operations]);
  const openOperation = (id: string, kind = "files") =>
    navigate(
      `/audit?view=operations${id ? `&operation=${id}&kind=${kind}` : ""}`,
    );
  const exportPage = () =>
    void action.run(async () => {
      // Bounded export pages are independently re-authorized, never a cached UI dump.
      const result = await api<AuditResult>(
        `audit/export?${filters}&limit=200${cursor ? `&cursor=${cursor}` : ""}`,
      );
      const blob = new Blob(
        [
          JSON.stringify(
            { exportedAt: new Date().toISOString(), ...result },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      );
      const href = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = href;
      link.download = `axiom-audit-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    });
  const content = (
    <>
      {!embedded && (
        <PageHeading eyebrow="WORKSPACE RECORDS" title="Audit">
          A durable record of changes, saved versions and background operations.
          History follows your current access.
        </PageHeading>
      )}
      {!embedded && (
        <nav className="productivity-tabs" aria-label="Audit views">
          <WorkspaceLink
            to={`/audit${space ? `?space=${space}` : ""}`}
            className={!operations ? "active" : ""}
          >
            <History size={16} />
            History
          </WorkspaceLink>
          <WorkspaceLink
            to="/audit?view=operations"
            className={operations ? "active" : ""}
          >
            <ListChecks size={16} />
            Operations
          </WorkspaceLink>
        </nav>
      )}
      <ErrorNotice
        message={data.error || jobs.error || action.error}
        retry={() => {
          data.reload();
          jobs.reload();
        }}
      />
      {operations ? (
        <>
          <div className="console-toolbar">
            <p className="ws-note">
              Completed changes persist. Cancel only stops work that has not yet
              completed.
            </p>
            <label>
              Status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">All statuses</option>
                {[
                  "queued",
                  "running",
                  "completed",
                  "cancelled",
                  "failed",
                  "done",
                ].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
          {operationId ? (
            <>
              {operationKind === "trash" ? (
                <TrashOperationDialog
                  key={operationId}
                  id={operationId}
                  embedded
                  onClose={() => openOperation("")}
                  onComplete={refresh}
                />
              ) : operationKind === "workspace" ? (
                <p className="ws-note">
                  Workspace deletion is processed in the background. Open its
                  Lifecycle page to review blockers or cancel during the grace
                  period.
                </p>
              ) : (
                <FileOperationActivity
                  key={operationId}
                  id={operationId}
                  embedded
                  onClose={() => openOperation("")}
                  onOpen={(id) => openOperation(id)}
                />
              )}
              <button className="text-button" onClick={() => openOperation("")}>
                <ArrowLeft size={15} />
                Back to operations
              </button>
            </>
          ) : (
            <div className="console-records">
              {jobs.data?.items
                .filter((job) => !status || job.status === status)
                .map((job) => (
                  <button
                    className="console-record"
                    key={job.id}
                    onClick={() =>
                      job.kind === "workspace" && job.space_id
                        ? navigate(`/workspaces/${job.space_id}/lifecycle`)
                        : openOperation(job.id, job.kind)
                    }
                  >
                    <ListChecks size={18} />
                    <span>
                      <strong>
                        {auditLabel(job.command)} ·{" "}
                        {job.kind === "workspace"
                          ? "Workspace"
                          : `${job.total} items`}
                      </strong>
                      <small>
                        {new Date(job.created_at).toLocaleString()} · {job.done}{" "}
                        completed
                        {job.blocked ? ` · ${job.blocked} need attention` : ""}
                      </small>
                    </span>
                    <span className="ws-badge">{job.status}</span>
                  </button>
                ))}
              {!jobs.loading && !jobs.data?.items.length && (
                <Empty title="No operations yet">
                  Moves, batch changes and cleanup progress appear here.
                </Empty>
              )}
            </div>
          )}
          {!operationId && (
            <div className="console-pagination">
              <button
                className="button secondary"
                disabled={!operationOffset}
                onClick={() => setOperationOffset((n) => Math.max(0, n - 50))}
              >
                Previous
              </button>
              <button
                className="button secondary"
                disabled={jobs.data?.nextOffset == null}
                onClick={() => setOperationOffset(jobs.data!.nextOffset!)}
              >
                Next
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="console-toolbar">
            <label className="console-search">
              Search history
              <input
                type="search"
                placeholder="Item or person…"
                value={search}
                onChange={(e) => updateFilters({ q: e.target.value })}
              />
            </label>
            {!spaceId && (
              <label>
                Workspace
                <select
                  aria-label="Workspace"
                  value={space}
                  onChange={(e) => updateFilters({ space: e.target.value })}
                >
                  <option value="">All accessible</option>
                  {space && !spaces.some((s) => s.id === space) && (
                    <option value={space}>
                      {scopeDetails.data?.space.name ?? "Selected workspace"}
                    </option>
                  )}
                  {spaces.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Action
              <select
                aria-label="Action"
                value={actionFilter}
                onChange={(e) => updateFilters({ action: e.target.value })}
              >
                <option value="">All actions</option>
                {[
                  "create",
                  "rename",
                  "update",
                  "move",
                  "replace",
                  "trash",
                  "restore",
                  "purge",
                  "checkpoint",
                  "named-version",
                  "restore-version",
                  "archived",
                  "active",
                  "trashed",
                  "purging",
                ].map((v) => (
                  <option key={v} value={v}>
                    {auditLabel(v)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Item type
              <select
                aria-label="Item type"
                value={entity}
                onChange={(e) => updateFilters({ entity: e.target.value })}
              >
                <option value="">All types</option>
                {[
                  "note",
                  "folder",
                  "file",
                  "shortcut",
                  "workspace",
                  "group",
                  "project",
                  "membership",
                  "invitation",
                  "integration",
                  "document-version",
                  "favorite",
                  "folder-color",
                ].map((v) => (
                  <option key={v} value={v}>
                    {auditLabel(v)}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="icon-button"
              title="Export up to 200 records from this page (JSON)"
              aria-label="Export audit page"
              disabled={action.busy}
              onClick={exportPage}
            >
              <ArrowDownToLine size={17} />
            </button>
            <button
              className="icon-button"
              title="Refresh history"
              aria-label="Refresh history"
              onClick={data.reload}
            >
              <RefreshCw size={17} />
            </button>
          </div>
          <details className="console-filter-details">
            <summary>Date and person filters</summary>
            <div className="console-toolbar">
              <label>
                From
                <input
                  type="date"
                  value={after}
                  onChange={(e) => updateFilters({ after: e.target.value })}
                />
              </label>
              <label>
                Through
                <input
                  type="date"
                  value={before}
                  onChange={(e) => updateFilters({ before: e.target.value })}
                />
              </label>
              <label>
                Person ID
                <input
                  value={actor}
                  placeholder="Select a person from record details"
                  onChange={(e) => updateFilters({ actor: e.target.value })}
                />
              </label>
              <button
                className="text-button"
                onClick={() => {
                  updateFilters({
                    after: "",
                    before: "",
                    actor: "",
                    q: "",
                    action: "",
                    entity: "",
                  });
                }}
              >
                Clear filters
              </button>
            </div>
          </details>
          <div
            className={`console-master-detail ${selected ? "has-inspector" : ""}`}
          >
            <div>
              {data.loading && !data.data ? (
                <Loading />
              ) : !data.data?.items.length ? (
                <Empty title="No matching history" icon={History}>
                  Try another filter. Older records contain only the evidence
                  that was actually retained.
                </Empty>
              ) : (
                <div className="console-records">
                  {data.data.items.map((event) => (
                    <button
                      className={`console-record ${selected === event.id ? "selected" : ""}`}
                      key={event.id}
                      onClick={() => setSelected(event.id)}
                    >
                      <History size={17} />
                      <span>
                        <strong>{event.entity_name}</strong>
                        <small>
                          {event.actor_name} · {auditLabel(event.action)} ·{" "}
                          {auditLabel(event.entity_type)}
                        </small>
                      </span>
                      <time dateTime={event.created_at}>
                        {new Date(event.created_at).toLocaleString()}
                      </time>
                    </button>
                  ))}
                </div>
              )}
              <div className="console-pagination">
                <button
                  className="button secondary"
                  disabled={!previous.length || data.loading}
                  onClick={() => {
                    setCursor(previous.at(-1) ?? null);
                    setPrevious((p) => p.slice(0, -1));
                  }}
                >
                  <ArrowLeft size={15} />
                  Newer
                </button>
                <button
                  className="button secondary"
                  disabled={!data.data?.nextCursor || data.loading}
                  onClick={() => {
                    setPrevious((p) => [...p, cursor]);
                    setCursor(data.data!.nextCursor);
                  }}
                >
                  Older
                  <ArrowRight size={15} />
                </button>
              </div>
              <p className="ws-note">
                Metadata history is retained. Automatic document versions expire
                after 30 days; named versions and review evidence are kept. A
                purge removes content, not its authorized audit record.
              </p>
            </div>
            {selected && (
              <aside className="console-inspector" aria-label="Change details">
                <div className="ws-section-heading">
                  <h2>Change details</h2>
                  <button
                    className="icon-button"
                    aria-label="Close change details"
                    onClick={() => setSelected(null)}
                  >
                    <X size={17} />
                  </button>
                </div>
                <ErrorNotice message={detail.error} retry={detail.reload} />
                {detail.data ? (
                  <AuditDetails
                    key={detail.data.id}
                    event={detail.data}
                    onActor={(id) => {
                      updateFilters({ actor: id });
                    }}
                  />
                ) : detail.loading ? (
                  <Loading />
                ) : null}
              </aside>
            )}
          </div>
        </>
      )}
    </>
  );
  return embedded ? (
    <section className="console-audit">{content}</section>
  ) : (
    <main className="ws-page console-page">{content}</main>
  );
}

function AuditDetails({
  event,
  onActor,
}: {
  event: AuditEvent;
  onActor: (id: string) => void;
}) {
  const [compare, setCompare] = useState(false),
    { revision } = useWorkspace();
  const version = useData<{
    body: string;
    previous_body: string | null;
    title: string;
  }>(compare ? `audit/${event.id}/version` : null, revision);
  const changes = auditChanges(event);
  const display = (value: unknown) =>
    value === undefined
      ? "Not recorded"
      : value === null
        ? "None"
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
  return (
    <>
      <h3>{event.entity_name}</h3>
      <p>
        {auditLabel(event.action)} ·{" "}
        {new Date(event.created_at).toLocaleString()}
      </p>
      {event.actor_id ? (
        <button
          className="text-button"
          onClick={() => onActor(event.actor_id!)}
        >
          By {event.actor_name}
        </button>
      ) : (
        <p>{event.actor_name}</p>
      )}
      {event.contributors.length > 1 && (
        <p className="ws-note">
          {event.contributors.length} contributors in this editing checkpoint.
        </p>
      )}
      {event.space_name && <p className="ws-note">{event.space_name}</p>}
      {changes.length ? (
        <div className="audit-changes">
          {changes.map((change) => (
            <div key={change.key}>
              <strong>{auditLabel(change.key)}</strong>
              <del>
                <small>Before · </small>
                {display(change.before)}
              </del>
              <ins>
                <small>After · </small>
                {display(change.after)}
              </ins>
            </div>
          ))}
        </div>
      ) : (
        <p className="ws-note">
          {event.evidence === "legacy-summary"
            ? "Legacy summary. Before and after values were not recorded."
            : "No field-level comparison is available for this event."}
        </p>
      )}
      {event.resource_available && (
        <WorkspaceLink
          className="button secondary"
          to={
            event.resource_kind === "folder"
              ? `/explorer?folder=${event.entity_id}&space=${event.resource_space_id}`
              : event.resource_kind === "note"
                ? `/notes/${event.entity_id}`
                : `/files/${event.entity_id}`
          }
        >
          <ExternalLink size={15} />
          Open item
        </WorkspaceLink>
      )}
      {event.version_id &&
        (event.version_available ? (
          event.entity_type === "file-version" ? (
            <WorkspaceLink
              className="button secondary"
              to={`/files/${event.entity_id}?version=${event.version_id}`}
            >
              Open retained file version
            </WorkspaceLink>
          ) : (
            <button
              className="button secondary"
              onClick={() => setCompare((v) => !v)}
            >
              {compare ? "Hide" : "Compare"} saved version
            </button>
          )
        ) : (
          <p className="ws-note">
            The version body has expired, was purged, or is no longer
            accessible. Its metadata remains in history.
          </p>
        ))}
      <ErrorNotice message={version.error} retry={version.reload} />
      {compare && version.data && (
        <div className="audit-version-comparison">
          <h4>Changes from the previous retained version</h4>
          {!version.data.previous_body && (
            <p className="ws-note">
              No earlier retained body. This version is shown as added text.
            </p>
          )}
          <pre aria-label="Saved version line comparison">
            {auditVersionDiff(
              version.data.previous_body ?? "",
              version.data.body,
            ).map((line, i) => (
              <span key={i} className={`audit-diff-line ${line.kind}`}>
                {line.kind === "added"
                  ? "+ "
                  : line.kind === "removed"
                    ? "− "
                    : "  "}
                {line.text}
                {"\n"}
              </span>
            ))}
          </pre>
        </div>
      )}
    </>
  );
}
