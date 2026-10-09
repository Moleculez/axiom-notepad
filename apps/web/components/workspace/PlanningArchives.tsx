"use client";
import { currentLocale } from "@axiom/i18n/client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import { useId, useState } from "react";
import {
  occurrenceQuerySchema,
  type HistoryQuery,
  type HistoryPage,
  type OccurrenceQuery,
  type OccurrencePage,
} from "@axiom/shared/planning-archives";
import { ListFilter } from "lucide-react";
import { taskStatusSchema } from "@axiom/shared/workspace";
import Dialog, { DialogBody, DialogFooter } from "../Dialog";
import {
  ActionRow,
  Button,
  Checkbox,
  Field,
  HelpText,
  NativeSelect,
  TextInput,
} from "../ui/controls";
import {
  ArchiveSearch,
  ArchivePagination,
  usePlanningArchive,
} from "./PlanningArchiveControls";
import { Empty, ErrorNotice, Loading, useWorkspace, WorkspaceLink } from "./ui";

const historyDefaults: HistoryQuery = {
  q: "",
  sort: "newest",
  limit: 30,
  mine: "0",
};
const occurrenceDefaults: OccurrenceQuery = {
  q: "",
  sort: "newest",
  limit: 30,
  state: "all",
};
export function PlanningHistoryDialog({
  spaceId,
  id,
  title,
  onClose,
  onNavigate,
  withOccurrences = false,
}: {
  spaceId: string;
  id: string;
  title: string;
  onClose: () => void;
  onNavigate?: () => void;
  withOccurrences?: boolean;
}) {
  useInterfaceLocale();
  const { revision } = useWorkspace();
  const [tab, setTab] = useState<"changes" | "tasks">("changes");
  const [filtering, setFiltering] = useState(false);
  const tabId = useId();
  const history = usePlanningArchive<HistoryQuery, HistoryPage>(
    `spaces/${spaceId}/planning-history/${id}`,
    historyDefaults,
    revision,
    tab === "changes",
  );
  const tasks = usePlanningArchive<OccurrenceQuery, OccurrencePage>(
    `spaces/${spaceId}/recurrences/${id}/occurrences`,
    occurrenceDefaults,
    revision,
    tab === "tasks",
  );
  const active = tab === "changes" ? history : tasks;
  const data = active.data;
  const items = data.data?.items ?? [];
  return (
    <>
      <Dialog
        title={title}
        size="wide"
        className="planning-archive-dialog"
        onClose={onClose}
        subtitle={uiText(
          "Saved changes stay live. Refresh includes new entries.",
        )}
      >
        <DialogBody>
          <div className="planning-archive-content">
            {withOccurrences && (
              <ActionRow
                className="planning-archive-tabs"
                aria-label={uiText("Routine history sections")}
              >
                <Button
                  size="compact"
                  variant={tab === "changes" ? "secondary" : "ghost"}
                  aria-pressed={tab === "changes"}
                  aria-controls={tabId}
                  onClick={() => setTab("changes")}
                >
                  <I18nText id="Changes" />
                </Button>
                <Button
                  size="compact"
                  variant={tab === "tasks" ? "secondary" : "ghost"}
                  aria-pressed={tab === "tasks"}
                  aria-controls={tabId}
                  onClick={() => setTab("tasks")}
                >
                  <I18nText id="Generated tasks" />
                </Button>
              </ActionRow>
            )}
            <ArchiveSearch
              label={
                tab === "changes"
                  ? uiText("Search changes")
                  : uiText("Search generated tasks")
              }
              search={active.search}
              onSearch={active.setSearch}
              sort={tab === "changes" ? history.filters.sort : undefined}
              onSort={
                tab === "changes" ? (sort) => history.set({ sort }) : undefined
              }
              loading={data.loading}
              onRefresh={active.refresh}
            >
              {tab === "tasks" && (
                <Button size="compact" onClick={() => setFiltering(true)}>
                  <ListFilter size={14} />
                  <I18nText id="Filters" />
                  {tasks.filters.state !== "all" ||
                  tasks.filters.status ||
                  tasks.filters.from ||
                  tasks.filters.to ||
                  tasks.filters.sort !== "newest"
                    ? uiText(" · On")
                    : ""}
                </Button>
              )}
            </ArchiveSearch>
            {tab === "changes" && (
              <label className="planning-check-label">
                <Checkbox
                  checked={history.filters.mine === "1"}
                  onChange={(e) =>
                    history.set({ mine: e.target.checked ? "1" : "0" })
                  }
                />
                <I18nText id="My changes" />
              </label>
            )}
            <div className="planning-archive-summary">
              <HelpText aria-live="polite">
                {data.data
                  ? `${data.data.total} matching ${tab === "changes" ? "changes" : "generated tasks"}`
                  : uiText("Loading archive…")}
              </HelpText>
              <Button size="compact" variant="ghost" onClick={active.reset}>
                <I18nText id="Reset filters" />
              </Button>
            </div>
            <ErrorNotice message={data.error} retry={active.refresh} />
            <div
              id={tabId}
              className="planning-archive-results"
              ref={active.resultsRef}
              aria-busy={data.loading}
            >
              {data.loading && !data.data ? (
                <Loading />
              ) : data.error && !data.data ? null : !items.length ? (
                <Empty
                  title={`No matching ${tab === "changes" ? "changes" : "generated tasks"}`}
                >
                  <I18nText id="Try another filter, or Refresh to start from the first page." />
                </Empty>
              ) : tab === "changes" ? (
                <ol className="planning-history-list">
                  {history.data.data?.items.map((h) => (
                    <li key={h.id}>
                      <strong>{h.summary}</strong>
                      <HelpText as="span">
                        {h.actor_name ?? "Former member"} ·{" "}
                        <time dateTime={h.created_at}>
                          {new Date(h.created_at).toLocaleString(
                            currentLocale(),
                          )}
                        </time>
                      </HelpText>
                    </li>
                  ))}
                </ol>
              ) : (
                <ol className="planning-occurrence-list">
                  {tasks.data.data?.items.map((o) => (
                    <li key={o.id}>
                      <WorkspaceLink
                        to={`/workspaces/${spaceId}/planning?task=${o.id}${o.deleted_at ? "&deleted=1" : ""}`}
                        onClick={(event) => {
                          // Modified clicks retain native new-tab behavior and the current archive.
                          if (
                            !event.defaultPrevented &&
                            event.button === 0 &&
                            !event.metaKey &&
                            !event.ctrlKey &&
                            !event.shiftKey &&
                            !event.altKey
                          )
                            onNavigate?.();
                        }}
                      >
                        {o.title}
                      </WorkspaceLink>
                      <HelpText as="span">
                        <time dateTime={o.occurs_on}>
                          {o.occurs_on.slice(0, 10)}
                        </time>{" "}
                        · {o.status.replaceAll("_", " ")}
                        {o.deleted_at ? uiText(" · Deleted task") : ""}
                      </HelpText>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <ArchivePagination
            label={
              tab === "changes" ? uiText("Changes") : uiText("Generated tasks")
            }
            {...active.pagination}
          />
        </DialogFooter>
      </Dialog>
      {filtering && (
        <OccurrenceFilters
          filters={tasks.filters}
          onClose={() => setFiltering(false)}
          onApply={(patch) => {
            tasks.set(patch);
            setFiltering(false);
          }}
        />
      )}
    </>
  );
}
function OccurrenceFilters({
  filters,
  onClose,
  onApply,
}: {
  filters: OccurrenceQuery;
  onClose: () => void;
  onApply: (patch: Partial<OccurrenceQuery>) => void;
}) {
  useInterfaceLocale();
  const [draft, setDraft] = useState({
    state: filters.state,
    status: filters.status,
    from: filters.from,
    to: filters.to,
    sort: filters.sort,
  });
  const set = (patch: Partial<typeof draft>) =>
    setDraft((old) => ({ ...old, ...patch }));
  const parsed = occurrenceQuerySchema.safeParse({ ...filters, ...draft });
  return (
    <Dialog title={uiText("Filter generated tasks")} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (parsed.success) onApply(draft);
        }}
      >
        <DialogBody>
          <div className="planning-suite-form">
            <Field label={uiText("Availability")}>
              <NativeSelect
                value={draft.state}
                onChange={(e) =>
                  set({ state: e.target.value as OccurrenceQuery["state"] })
                }
              >
                <option value="all">
                  <I18nText id="All generated tasks" />
                </option>
                <option value="active">
                  <I18nText id="Available tasks" />
                </option>
                <option value="deleted">
                  <I18nText id="Deleted tasks" />
                </option>
              </NativeSelect>
            </Field>
            <Field label={uiText("Status")}>
              <NativeSelect
                value={draft.status ?? ""}
                onChange={(e) =>
                  set({
                    status: e.target.value
                      ? taskStatusSchema.parse(e.target.value)
                      : undefined,
                  })
                }
              >
                <option value="">
                  <I18nText id="All statuses" />
                </option>
                {taskStatusSchema.options.map((s) => (
                  <option key={s} value={s}>
                    {s.replaceAll("_", " ")}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="planning-field-grid">
              <Field label={uiText("Occurrence from")}>
                <TextInput
                  type="date"
                  value={draft.from ?? ""}
                  max={draft.to}
                  onChange={(e) => set({ from: e.target.value || undefined })}
                />
              </Field>
              <Field
                label={uiText("Occurrence until")}
                error={
                  !parsed.success
                    ? "Choose an end date on or after the start date."
                    : undefined
                }
              >
                <TextInput
                  type="date"
                  value={draft.to ?? ""}
                  min={draft.from}
                  onChange={(e) => set({ to: e.target.value || undefined })}
                />
              </Field>
            </div>
            <Field label={uiText("Occurrence order")}>
              <NativeSelect
                value={draft.sort}
                onChange={(e) =>
                  set({ sort: e.target.value as OccurrenceQuery["sort"] })
                }
              >
                <option value="newest">
                  <I18nText id="Newest first" />
                </option>
                <option value="oldest">
                  <I18nText id="Oldest first" />
                </option>
              </NativeSelect>
            </Field>
            <HelpText>
              <I18nText id="Dates refer to generated occurrences. Deleted tasks open in the workspace’s Deleted tasks view; template edits never rewrite them." />
            </HelpText>
          </div>
        </DialogBody>
        <DialogFooter>
          <ActionRow>
            <Button data-dialog-cancel type="button" onClick={onClose}>
              <I18nText id="Cancel" />
            </Button>
            <Button type="submit" variant="primary" disabled={!parsed.success}>
              <I18nText id="Apply filters" />
            </Button>
          </ActionRow>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
