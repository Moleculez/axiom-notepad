# Unified workspaces and planning

Files and project work now live in one Workspace. Personal and group workspaces
share the same shell: **Overview · Files · Planning · Discussions · Reviews ·
Settings**. The sidebar remains stable across these sections. Clicking a workspace
resumes its previous view on this account/device; a first visit opens Overview.
The directory and its New workspace action are available in the page launcher.

## Planning interactions

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

Milestones can be created, dated, completed and reopened. Recurring task templates
can be created, paused and resumed; the workspace worker creates occurrences.
Workspace/task discussions support replies. Reviews reuse the existing
snapshot-bound resource-review workflow rather than a second approval engine.

## Gantt and scheduling

- Day, Week and Month zoom, Fit, Today, collapsible task groups, milestones,
  dependency lines, a resizable label column and virtualized rows share a single
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
- A preview belongs to its creator and expires after 15 minutes. Apply checks
  workspace planning revision, task versions, access and lifecycle inside one
  transaction. Retries are idempotent. Guarded Undo restores the prior dates only
  if the affected versions still match; it does not overwrite a peer's later edit.

Workspace Settings → General includes the working calendar: time zone,
working weekdays (Monday–Friday by default), and exceptional working/non-working
dates. Dates remain calendar dates, not browser-local timestamps. Calendar changes
do not silently rewrite existing schedules; new previews use the updated calendar.

Export provides CSV, a portable SVG timeline and a print/PDF task table for the
**loaded filtered tasks**, excluding descriptions and private drafts. SVG uses a
portable light palette and task bars; it is not an exact screenshot of dependency
lines/milestone decorations. CSV cells guard spreadsheet formula prefixes.
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
and an all-account planning export are not delivered here. Parent/dependency
pickers use tasks in the current filtered view (up to 150 matching choices); clear
filters to find another task. Capacity uses estimates, not tracked time.

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
- Manual and assistant schedule previews show changed member-weeks. Their capacity
  impact is deliberately **workspace-only** against group availability; consult
  the group capacity view for combined commitments. Previews show at most 52 weeks
  and 200 changed member-weeks, with a partial-coverage notice. They do not level
  resources. Availability changes invalidate previously reviewed schedules.
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
TEST_APP_URL=http://localhost:3004 npx playwright test tests/e2e/workspace-planning.spec.ts --trace off
```

Repeat with `TEST_BROWSER=firefox` and `TEST_BROWSER=webkit`. The acceptance cases
cover creation, local draft recovery, Gantt preview/apply/Undo, workspace identity,
legacy links and 5,000-row virtualization. The API rehearsal separately exercises
actual 5,000-row filtering, permissions, cycles, lifecycle, stale revisions and
audit. [Verification](VERIFICATION.md) records dated executed checks and remaining
deployment/device gates; screenshots and test databases are private local evidence.
