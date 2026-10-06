# Unified workspaces and planning

Files and project work now live in one Workspace. Personal and group workspaces
share the same shell: **Overview · Research · Files · Planning · Discussions ·
Reviews · Website · Settings**. The sidebar remains stable across these sections. Clicking a workspace
resumes its previous view on this account/device; a first visit opens Overview.
The directory and its New workspace action are available in the page launcher.

## Planning interactions

Planning contains **Tasks · Goals · Intake**, without additional sidebar pages.
List, Board, Calendar, Gantt and Workload share the same server-side search,
status, priority, assignee, milestone and deleted-task filters. Section navigation
retains its last filters. Task links use
`/workbench/workspaces/:spaceId/planning?task=:taskId`. File URLs and identities
remain unchanged. Old project URLs redirect to the corresponding workspace.

The task inspector supports Markdown descriptions using the current application
editor, status, priority, assignee, labels, effort, parent/subtasks, dependencies,
milestones and linked research files. Description changes are **local drafts**
until Save task, not live Yjs co-editing. Task saves use optimistic versions;
another person's newer version is never silently replaced. Workspace invalidation
refreshes saved data while retaining dirty drafts.

Unfinished drafts are account/workspace/task scoped on this device. Leaving asks
whether to retain the draft; reopening recovers it. Discard removes that draft.
Local-storage failure is visible. Offline shared mutations are disabled, and
drafts are not an offline mutation queue or a backup. Deleted tasks retain their
history and can be restored from the Deleted tasks filter. Linked task evidence
protects referenced files against permanent removal and cross-workspace moves.

Milestones can be created, dated, completed and reopened. Recurring routines
support daily/weekly/monthly rules, intervals, date bounds and weekdays, next-five
occurrence previews, full future-template edits, history, pause/resume and
archive/reopen-paused. Existing generated tasks are never rewritten. The worker
creates at most one task per routine/date and processes bounded catch-up batches.
Workspace/task discussions support replies. Reviews reuse the existing
snapshot-bound resource-review workflow rather than a second approval engine.

## Gantt and scheduling

- Day, Week, Month, Quarter and Year zoom, anchored zoom, Fit, Today, dual date
  headers, collapsible task/assignee/milestone groups, configurable columns,
  milestones, dependency lines, a resizable task column and virtualized rows share a single
  scrollport. Unscheduled tasks remain visible rather than receiving fake dates.
- Drag a bar or either edge to propose dates. Keyboard/click access opens task
  details; Reschedule offers explicit date fields, including clearing dates.
  Nothing is committed by dragging alone.
- Preview lists original/proposed dates and affected titles, including tasks
  outside the current filter. Choose direct changes only or the proposed dependent
  shifts. Finish-to-start conflicts are pushed forward; successors are never
  automatically pulled earlier. Completed/cancelled tasks and undated predecessor
  cases are reported rather than silently rescheduled.
- The full workspace graph is validated, not only visible/paged tasks. Self-links,
  missing dependencies and cycles are rejected. Subtask ancestry is checked
  separately from scheduling dependencies.
- Drag a finish connector to another task's start, click a dependency line, or
  use **Link tasks** to create/edit/remove a relationship. Finish-to-start links
  have an integer offset of −365…365 **working days**: zero means the next
  working day after finish, positive delays and negative permits overlap.
  Link saves change metadata only, never dates. Legacy ID-only writes retain
  existing offsets; new ID-only relationships default to zero. Proposals,
  conflicts, critical path/slack, baselines and exports use the same offsets.
- Leaf progress is manually editable; Done means 100%. Parent and grouping
  progress is derived from non-cancelled descendant leaves, not saved rollup dates.
- A preview belongs to its creator and expires after 15 minutes. Apply checks
  workspace planning revision, task versions, access and lifecycle inside one
  transaction. Retries are idempotent. Guarded Undo restores the prior dates only
  if the affected versions still match; it does not overwrite a peer's later edit.

Workspace Settings → General includes the working calendar: time zone,
working weekdays (Monday–Friday by default), and exceptional working/non-working
dates. Dates remain calendar dates, not browser-local timestamps. Calendar changes
do not silently rewrite existing schedules; new previews use the updated calendar.

Export provides CSV, a portable SVG timeline and a print/PDF task table for the
**loaded filtered tasks** plus workspace milestones, excluding descriptions and
private drafts. SVG/print use a portable light palette with dependencies/offsets,
progress, critical path, milestones, a legend and the selected baseline. CSV
includes progress, predecessors/offsets, milestone records, baseline dates,
critical markers and explicit scope. CSV cells guard spreadsheet formula prefixes.
Workload reports remaining estimated hours, task counts and unestimated work,
not weekly utilization or automatic resource leveling.

## Groups, access and lifecycle

Group membership/ownership, invitations, providers, identity and group-wide
lifecycle belong in Group administration. Workspace identity/calendar/access
and lifecycle belong in that workspace's Settings. Renaming a workspace never
renames its group. Archiving/trashing the default group workspace affects only
that workspace, not every workspace in the group.

A group archive/Trash still restricts all its workspaces. Restoring the group
preserves each workspace's own state; restoring a workspace preserves its previous
active/archived state and individual file Trash states. Workspace Trash shows
independent rows rather than collapsing a group into one deletion target.

Existing group/content roles and restricted-workspace memberships remain in
force. Personal content remains owner-only; management alone does not grant
access to restricted files. Personal and default group workspaces are protected
from permanent purge. Eligible shared-workspace purge remains owner-only with
reference checks and a cancellation window. **Permanent group deletion is not
implemented.** See [management](MANAGEMENT_CONSOLE.md).

## Implementation and API boundary

- `packages/shared/src/planning.ts`: date/calendar validation, iterative DAG
  traversal, pure schedule proposals, draft validation and exports.
- `packages/shared/src/planning-api.ts`: workspace-scoped reads/writes, permission
  checks, full-graph validation, schedule receipts, audit and notifications.
- `UnifiedWorkspace.tsx`, `WorkspacePlanning.tsx`, `PlanningGantt.tsx`: workspace
  shell, shared planning views/inspector and custom virtual timeline.
- `space_id` is authoritative. Existing project rows/IDs and membership tables
  remain compatibility/ACL adapters; no fabricated project is needed for personal
  or default workspaces. The legacy project APIs delegate planning to the same
  service. File IDs, URLs, Markdown and Yjs bytes are not migrated to a new format.
- `/api/v1/spaces/:id/planning`, `/tasks`, `/milestones`, `/recurrences`,
  `/discussions`, `/planning-settings` and `/schedule/{preview,apply,undo}` are
  workspace-scoped. Task updates require a version; schedule writes require
  preview receipts. Mutation IDs make retried requests idempotent.
- MCP advertises workspace planning/task/calendar/milestone/discussion tools;
  calendar changes and schedule apply/Undo use the existing in-app approval
  boundary. MCP is scoped by current workspace access, not unrestricted SQL.

The UI loads at most 5,000 filtered tasks; larger results show a narrowing prompt.
List/Gantt rows are virtualized and Board columns load bounded batches. Full-graph
validation is capped at 50,000 active tasks per workspace; oversized graphs fail
explicitly. Timeline queries omit description bodies at the database boundary.
This is bounded research planning, not a claim of unlimited portfolio scale.

Finish-to-start is the only dependency type. Holiday
providers, automatic resource leveling, simultaneous task-description co-editing
and an all-account planning export are not delivered here. Entity pickers search
the entire authorized workspace, independent of current task filters. Results
are bounded to 100; type to narrow. Selected labels survive transient failures,
requests cancel on query changes, and failed lookups offer Retry. Deleted files,
files under trashed ancestors and restricted notes are excluded. Capacity uses
estimates, not tracked time.

## Views, bulk work, goals and intake

- Save filters/view/zoom/grouping/columns/layers as a private or shared view.
  Readers can save their own private views; workspace management is required for
  shared views. Edit/delete is version-fenced. Presets include My work, Upcoming,
  Blocked and Overdue. Private view details are not copied into shared activity.
- Select rows, Shift-select ranges, or select loaded tasks, up to 1,000. Bulk
  status, assignee, priority, label replacement and Trash/restore are atomic: one
  stale/inaccessible task aborts all. Parent/child Trash ordering is checked.
  Date shifts use the ordinary reviewed preview/apply/Undo path and show skipped
  undated/completed/cancelled counts; selection never authorizes silent date edits.
- Goals support owner, due date, Markdown, linked tasks/milestones or a manual
  current/target metric, history and archive/reopen. Selecting both parent and
  child counts each leaf once. Missing targets are reported rather than counted
  complete. Workspace progress indexes are reused across the goal list.
- Goals use server-side summary pages, literal title/description search, Active/
  Archived/All filters and matching state counts. **Filters** contains tracking
  type, My goals (owner) and oldest/newest creation order. Opening a goal explicitly
  loads its authorized Markdown and linked IDs; the loaded version stays the save
  fence. A peer refresh cannot replace an open draft, and a stale Save fails with
  that draft retained. Metric-only pages do not fetch the task graph.
- Intake is member-only, not an anonymous/public form. Research, Experiment,
  Paper review and Data request templates support Markdown and requested date/
  priority. Authors edit/resubmit undecided requests and withdraw them. Managers
  accept, reject or request changes with a review note. Acceptance creates exactly
  one linked task atomically; retries return the original result.
- Intake browses **all** accessible requests with server-side pages, not a latest-200
  cutoff. Choose Open requests, Decision history, All requests or an exact status;
  use **Filters** for request type, My requests and submission order; search literal
  title/body/review-note text and sort
  by oldest/newest submission. Status counts follow the search/type/author scope.
  Pages offer 15/30/60/100 rows and Previous/Next; changing filters resets the position.
  Empty, loading, unavailable and Retry states distinguish failures from no matches.
- List responses omit full Markdown bodies. Opening details/review fetches one
  currently authorized request; the original version remains the save fence. Peer
  changes disable stale decisions/resubmission without overwriting local drafts.
  Review and request dialogs have fixed action footers, busy/dirty closure guards
  and native field validation. Accepted requests link to their task; decision notes
  and withdraw/accept history remain available rather than being deleted.
- Cursors retain exact timestamp/UUID positions, are tied to account/workspace and
  filters, and expire after 24 hours. Newer submissions do not shift older pages;
  Refresh returns to the first page. Counts and rows use one SQL statement snapshot.
  These are live requests, not immutable historical exports: status/author edits and
  commits of previously in-flight submissions can affect later pages. Reauthorization
  happens on every page/detail read; an old cursor does not retain revoked access.
- **History** pages through all retained per-entity metadata summaries, with literal
  summary search, My changes (actor) and oldest/newest order. It is not a Markdown
  diff or a complete field-change ledger. Routine history separates **Changes**
  from **Generated tasks**, with title search, date/status/availability filters and
  explicit deleted-task links. Occurrence dates remain calendar dates. Purging a
  generated task can remove its occurrence; this is not an immutable task archive.
- Goals, changes and generated tasks offer 15/30/60/100-row pages. Counts/rows share
  one SQL statement snapshot; progress is a live calculation. Timestamp/UUID or
  unique routine/date positions are exact, account/workspace/entity/filter-scoped
  and expire after 24 hours. Changing filters resets the page and results scroll;
  Refresh returns to the first page. A creation ceiling excludes newly created
  records from later pages, not later edits or previously in-flight transactions.
  Every read rechecks access; cursors are positions, never credentials.
- Goals retain the **200 total workspace cap, including archived goals**. The
  unfiltered live total controls creation capacity; searching or choosing another
  owner does not grant additional slots. Existing goals can be edited or reopened.
  Goal/intake/routine forms guard unsaved closure and disable edits during saves.
  Shared filters/actions stay outside result scrollports, and forms retain fixed
  native-owned footers. Loaded page actions remain usable during peer refreshes.

### Archive API contract

`GET /api/v1/spaces/:id/goals` now returns `{items,total,stateCounts,workspaceTotal,
goalLimit,asOf,nextCursor}`, not the former whole-collection array. Default is
Active, newest **creation** first, 30 items; `filter=all` includes archives. Query
fields are `q`, `filter=active|archived|all`, `kind=linked|metric`, `mine=0|1`,
`sort=newest|oldest`, `limit=1..100` and `cursor`. Items omit Markdown and linked
ID arrays. `GET /goals/:goalId` returns `{item}` including those details; writes
retain mutation IDs and required original versions.

`GET /planning-history/:entityId` and `GET /recurrences/:routineId/occurrences`
return `{items,total,asOf,nextCursor}`, not latest-100 arrays. Both support `q`,
`sort`, `limit` and `cursor`. History supports `mine=0|1`; occurrences support
`state=all|active|deleted`, `status`, `from`/`to` (`YYYY-MM-DD`). Generated tasks
default to All; descriptions are not transferred. Counts follow filters, not the
current page. Connected AI/MCP reads use these same scoped summary/detail paths;
writes still require existing review/authorization and version fences.

## Group coordination and schedule analysis

- Open **Planning** on a group card, **Group portfolio** from a workspace, or use
  Search & commands. Named portfolios are saved sets of workspaces in one group.
  Overview/timeline show progress, dates, overdue/blocked work and milestones.
  Readers see only accessible active workspaces; administration never grants
  restricted-workspace contents implicitly. Group planning is bounded to 100
  workspaces and 100,000 tasks. Administrators manage portfolio membership.
- **Insights & baselines** captures immutable tasks/calendar/milestones at a
  planning revision. Compare current or earlier baselines, inspect field/date
  differences and export JSON. Managers can rename/archive snapshots; archiving
  does not erase evidence. Maximum 100 baselines per workspace.
- Critical path/slack uses the full dependency graph and working-day calendar.
  Current starts are lower bounds; completed predecessors are satisfied. Missing
  dates or cancelled/incomplete predecessors exclude dependent chains and mark
  the forecast partial. Gantt overlays do not change saved dates automatically.
- **Capacity** distributes each open task's own estimate across its scheduled
  working days; parent rollups are not counted again. Unassigned, unestimated and
  undated tasks are listed separately. Weeks start Monday; range is 1–52 weeks.
  Availability is explicit per group/member, with weekday and date exceptions.
  Blank means unknown, zero means unavailable. Members edit themselves; group
  administrators can edit others. No timers/timesheets are introduced.
- Manual and assistant schedule previews show changed member-weeks across the
  caller's **accessible active group workspaces**, using each working calendar.
  Restricted/ungranted workspaces are not exposed; the preview states partial
  coverage and unknown availability. Previews show at most 52 weeks
  and 200 changed member-weeks, with a partial-coverage notice. They do not level
  resources. Cohort planning/membership/calendar/lifecycle changes, current
  accessible workspace IDs and availability versions are fenced at apply.
- PDF annotations can link to an existing or new task in the paper's workspace.
  Links preserve PDF version/page/annotation identity without copying private
  text. Visibility follows current paper and annotation permissions. Deleted or
  pruned source versions do not silently redirect to the latest version.
- MCP adds scoped portfolio/capacity/analysis/baseline reads and approved baseline,
  portfolio-create and availability writes. Integration workspace grants still
  bound aggregate results; provider administration is not exposed.

Migrations **29–30** are additive metadata; existing task IDs, documents and CRDT
bytes are unchanged. Migration 29 backfills each existing assistant conversation
with its original single-workspace boundary. Back up, stop old writers, migrate,
then restart matching web/sync/worker builds; do not run mixed schema versions.

## Upgrade and verification

Forward migration **45** adds creation/UUID page indexes for Goals and per-entity
history. Routine occurrences already have a unique routine/date index. The upgrade
does not rewrite bodies, IDs, versions, histories, dates or CRDT state. Back up,
stop old writers, migrate, then restart matching web/sync/worker builds. Never seed
or reset an existing installation; local acceptance does not migrate working data.

```sh
npm run verify:planning-archives:migration
npm run verify:reliability -- --grep='planning archives|goal details|complete bounded|planning controls|offset compatibility'
```

The first command owns a new embedded PostgreSQL cluster and rehearses 44→current
plus idempotent rerun. The second owns isolated authenticated build/web/sync/worker
services and tests 200 goals, 1,250 tied/microsecond metadata entries and 215 routine
occurrences, both sort directions, search/filters, lazy detail, stale saves,
permissions/revocation and large-text desktop layouts. The receipt records the
actual engine/filter arguments. See [current evidence](VERIFICATION.md). [Stage 3
lab planning](PLANNING_LAB.md) now implements typed fields, shared manual time and
reviewed non-AI rules in source. Migration 46, authenticated browser/worker/recovery
and broader portfolio/Gantt scale acceptance are still pending, not passed gates.

Forward migration **42** adds scope/status/author keyset indexes for Intake.
It does not rewrite request content, IDs, timestamps, decisions, tasks or history.
The local API rehearsal traverses 1,250 tied/microsecond positions, concurrent
submissions/edits, literal wildcard searches, filters/counts and membership revocation.
`npm run plugins:staging -- test --config planning.config.ts` runs isolated port-3004 browser acceptance (never the working
database); its new Intake fixtures cover more than 200 records, lazy details, stale
draft retention, all five styles, both modes, large text and fixed dialog actions.

Forward migration **39** adds relationship offsets, leaf progress, saved views,
Goals, Intake, metadata history, routine archive state and capacity receipt fences.
It preserves task/file IDs, descriptions, Markdown and Yjs bytes. Back up, stop
old writers, run `npm run db:migrate`, then restart matching web/sync/worker code.
Do not reset or seed an existing installation. The rehearsal below now includes
suite permissions, intake retry, recurring-worker idempotency, and MCP/in-app
change-set review/revocation as well as legacy upgrade checks.

Forward migration **25** adds workspace metadata/calendar/revisions, planning
scope columns, evidence links, preview receipts and metadata-only audit triggers.
Old default-workspace lifecycle is preserved as group lifecycle, while that
workspace gains an independent own-state. Existing task IDs, bodies, versions,
dates and note/file identities remain intact. Pending deletion jobs must finish
or be cancelled before migration; the preflight refuses ambiguous in-flight work.
Back up database and blobs, stop old writers, migrate, then restart matching
web/sync/worker builds. See [deployment](DEPLOYMENT.md#workspace-planning-migration-25).

Local-only upgrade/API rehearsal creates and retains a new disposable database:

```sh
npx tsx scripts/verify/verify-workspace-planning.ts
npx tsx scripts/verify/rehearse-current-migrations.ts
```

With isolated staging running on 3004 (never the working 8080 dataset):

```sh
npm run plugins:staging -- test tests/e2e/workspace-planning.spec.ts --trace off
```

Repeat with `TEST_BROWSER=firefox` and `TEST_BROWSER=webkit`. The acceptance cases
cover creation, local draft recovery, Gantt preview/apply/Undo, workspace identity,
legacy links and 5,000-row virtualization. The API rehearsal separately exercises
actual 5,000-row filtering, permissions, cycles, lifecycle, stale revisions and
audit. [Verification](VERIFICATION.md) records dated executed checks and remaining
deployment/device gates; screenshots and test databases are private local evidence.
