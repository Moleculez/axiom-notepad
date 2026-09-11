# Workspaces, Audit and Trash

Implemented September 11, 2026. This release reorganizes management without
changing the Markdown/Yjs format, editor engine, existing content, or account
appearance preferences.

## Where to go

| Page | Purpose |
| --- | --- |
| `/workbench/workspaces` | Find personal, team and project libraries; filter by group, state, kind and access; sort by name or stored bytes. |
| `/workbench/workspaces/:id/:section` | Overview, General, People & access, Invitations, Storage, Integrations, Activity and Lifecycle. |
| `/workbench/audit` | Searchable metadata history, changed fields, retained document-version comparisons and authorized JSON export. |
| `/workbench/audit?view=operations` | Background file/Trash operation progress, results, cancellation, retry and revision-safe file-operation undo. |
| `/workbench/trash` | Recover or permanently remove selected files/folders with a frozen, reviewable operation. |
| `/workbench/trash?view=workspaces` | Restore trashed workspaces or request owner-only permanent removal. |

The application page picker and management sidebar link these pages. Profile
**Manage workspaces** now opens the directory, not the old small dialog.
Workspace context menus open the selected workspace's management page.
Old `/workbench/admin/:group/:section` links redirect to the corresponding team
workspace. Account preferences remain separate from group administration.

The old **File operations** history entry/modal is retired. Normal move, copy,
rename, Trash and destination dialogs remain. Queuing an operation closes its
action dialog and leaves you in Explorer; progress and recovery live in Audit.

## Workspace management

- Directory cards show state, content role, management capability and stored
  bytes. Personal space is explicitly account-owned and protected from group
  lifecycle actions.
- General settings retain version checks, Save/Cancel and unsaved-draft guards.
  Group name/description and project name/description/color/audience/time zone reuse
  their canonical APIs; stale edits are not silently overwritten.
- People, content roles, project leads, invitations and group ownership reuse
  the existing deduplication, revision and last-owner/last-lead safeguards.
- Storage distinguishes current versions, previous versions, Trash and upload
  reservations. Group and project libraries share the group quota. Inactive
  workspaces cannot change quotas. Managers without private project content
  access see aggregate storage, never its file names.
- Lifecycle presents affected counts, inherited parent state, blockers,
  archive/unarchive, Trash/restore and the owner's purge grace period. Restoring
  a group preserves independently archived projects and individually trashed
  resources. Invitations/integrations keep their existing role restrictions.

## What Audit records

An append-only PostgreSQL log records committed changes to resources,
workspaces, groups, projects, memberships, invitations, integration metadata,
private favorites/folder colors, file versions, document checkpoints, named
versions and document generation restoration.

Records carry an event-time actor name, actor ID when known, scope, timestamp,
changed metadata, operation ID and/or version ID where available. Current
editing checkpoints also preserve the set of contributing accounts; a shared
checkpoint is not attributed to an invented single author.

Explicit field whitelists include names, descriptions, tags, locations, roles,
audience, lifecycle state, quotas and selected integration settings. Bodies,
passwords, credentials, invitation tokens and provider endpoint query strings
are not copied into the metadata log. Credential rotation is an event, not a
record of the credential. This is application history, not an authentication,
security-attempt or every-keystroke log.

Canonical-row triggers and request/job transaction context keep the event and
the mutation atomic. Rolled-back writes and no-op/idempotent retries do not
create false success records. Current access is checked on list, detail,
version and export requests; historical locations cannot expose inaccessible
workspace IDs. Private personalization remains owner-only, administration
events require management access, and a manager role alone never grants
private content history. File/Trash result details are also redacted when
access changes.

Metadata survives resource and workspace purges. Retained scope records allow
authorized history after cascade deletion. For a fully purged group, only the
recorded final group owner retains access. A purged project in a surviving
group uses retained content access plus current group membership. Normal SQL
UPDATE, DELETE and TRUNCATE of the log are rejected. A database administrator
can still alter the schema: this is not a cryptographically tamper-proof log.

History filters are restored from the page URL, including when reloading or
switching application tabs. Pages use timestamp/ID cursors. JSON export returns
up to 200 authorized records from the current position and includes a
`nextCursor` for another page; it is deliberately not an unbounded account dump.
Document comparison shows added/removed lines against the previous retained
body; it is not a semantic or minimum-edit-distance diff.

### Versions and older history

- Accepted synchronization updates durably mark a note as pending. The sync
  maintenance loop persists journals before creating checkpoints after 60
  seconds idle, or five minutes of continuous editing. Its 15-second poll and
  bounded batches mean checkpoints can appear shortly after that threshold.
- Pending checkpoints survive editor closure and process restart. Unpersisted
  journals cannot become incomplete versions; unchanged bodies do not create
  redundant checkpoints.
- Automatic bodies expire after 30 days. Named versions and snapshots referenced
  by formal reviews remain protected; expiry does not remove audit metadata.
  Deliberate, authorized content/workspace purge remains a separate operation.
- Existing activity, lifecycle summaries and retained snapshots are backfilled.
  They are labeled as legacy evidence where appropriate. Missing historical
  actors or before/after values cannot be reconstructed and are not invented.

## Everyday Trash behavior

### Files and folders

Search, workspace/type/date filters and name/date/size sorting share one list.
Folder descendants expand in place. Plain, platform-modified and Shift clicks,
checkboxes, page selection and **all matching** selection are supported.
Selection actions appear only with a selection. Rows support keyboard movement
and grouped, icon-labeled context actions.

New deletions retain their original path and actor name. Older deletion paths
are explicitly labeled reconstructed. Restore supports the original parent
with parent recovery or workspace-root fallback, or a chosen active folder
within the same workspace. Name conflicts use **Keep both** (numbered names) or
**Skip**; there is no silent overwrite.

A preview freezes IDs, revisions, destination and choices. Selecting a folder
and its descendants does not process the same item twice. The worker rechecks
current access, workspace state, revisions, parents, destination validity,
uploads and protected references before acting. Changed or protected items
remain in Trash with a reason. Skipping a parent does not incorrectly restore
its children into that skipped subtree.

Permanent removal requires management **and** content access, an active scope,
typed confirmation and reference-safe cleanup. Cancellation stops remaining
work, not changes already completed. Reports retain completed/blocked/skipped
results; retry/recheck reuse the frozen selection, not a new live search.

### Workspaces

The workspace view includes state, group, affected item counts and stored bytes.
Groups collapse their included projects by default; they can be expanded for
inspection. Selecting a group and its projects collapses to one lifecycle
target, so restoration does not accidentally unarchive an independently
archived project.

Batch restore and permanent-removal previews use the same durable operation
reporting. Only the group owner can request permanent removal. A successful
workspace purge item means **queued for removal**, not that all bytes have
already disappeared. The existing 30-second cancellation window and final
reference/revision checks remain; Lifecycle shows the purge's current state.
Trash has no automatic expiry.

## Design contract

These desktop pages reuse the app's semantic colors, UI font and user-defined
type scale, shared buttons, quiet fields, icon/divider menus and centered
dialogs. Filters wrap, selection toolbars stay contextual, and Audit uses a
list plus a details panel. Keyboard focus remains visible even though mouse
inputs have no default browser outline. No separate mobile redesign was added.

## Migration and verification

Local verification on September 11:

| Check | Result |
| --- | --- |
| TypeScript and ESLint | Passed |
| Unit/conformance tests | 1,437 passed across 49 files |
| Next.js production candidate | Passed; build `dQiRZDAwZQZCq1N_9i1Wr`, 603 offline assets |
| Isolated migration/transaction/checkpoint rehearsal | Passed through migration 15 |
| Chromium management/productivity regressions | 17 passed |
| Firefox management acceptance | 5 passed |
| WebKit management acceptance, application navigation | 5 passed; routed UI also passed three consecutive repetitions |
| Collaboration/offline/generation regressions | 3 passed |
| Live 8080 management smoke | Passed, read-only; web and sync health checks passed |

Screenshots for the final UI flow are in
`test-results/management-console-chromium-ui-final/`,
`test-results/management-console-firefox-ui-final/` and
`test-results/management-console-webkit-final/`. The broader regression results
remain in `test-results/management-console-chromium/` and
`test-results/management-console-firefox/`. The live screenshots are in
`test-results/management-console-live-8080/`. These are targeted desktop checks,
not a rerun of every historical application scenario. See the navigation
stress limitation below; the earlier failing run is not represented as passing.

Forward-only migrations 13–15 add the audit log, retained scopes, checkpoint
queue, Trash options, deletion context and cascade-scope safeguards. Applied
migrations were not rewritten. A pre-release database/blob backup is retained
at `data/before-management-console-20260911`; its database and eight attachment
checksums were verified before the last migration.

Run the isolated schema/transaction/checkpoint rehearsal with:

```sh
npx tsx scripts/verify/verify-management-migration.ts
```

It creates a new disposable database and rolls back the fixtures. It covers
rollback/idempotency, actor/privacy/revocation, idle/collaborative checkpoints,
unpersisted journals, 30-day expiry, named/review retention, preserved purge
metadata and append-only rejection. It never seeds or deletes live research.

The retained staging database and attachment root use web 3002/sync 1235:

```sh
npx tsx scripts/run-management-staging.ts migrate
npx tsx scripts/run-management-staging.ts build
AXIOM_DIST_DIR=.next/management-console-20260911 npx tsx scripts/build/build-offline.ts
npx tsx scripts/run-management-staging.ts web
# Separate terminals:
npx tsx scripts/run-management-staging.ts sync
npx tsx scripts/run-management-staging.ts worker
```

Run browser suites sequentially against staging. They create disposable test
groups/accounts, not edits to the research workspace:

```sh
TEST_APP_URL=http://localhost:3002 npx playwright test tests/e2e/management-console.spec.ts tests/e2e/productivity-api.spec.ts tests/e2e/productivity-workflows.spec.ts tests/e2e/desktop-management.spec.ts --output=test-results/management-console-chromium
TEST_APP_URL=http://localhost:3002 TEST_BROWSER=firefox npx playwright test tests/e2e/management-console.spec.ts --output=test-results/management-console-firefox
TEST_APP_URL=http://localhost:3002 TEST_BROWSER=webkit npx playwright test tests/e2e/management-console.spec.ts --output=test-results/management-console-webkit
```

The live-service smoke only signs in and reads pages; a request guard blocks
management mutations. It does not save preferences or modify research:

```sh
npm run test:dev -- tests/dev-service/management-console.spec.ts --output=test-results/management-console-live-8080
```

Fresh desktop screenshots are written under each browser's test-result folder,
including Workspaces, General settings, Audit in light/dark themes, larger UI
type and Trash. Physical assistive-technology/native-device testing, remote
hosting, email delivery and external provider deployment are not certified by
these local browser checks.

### Navigation stress limit

One WebKit run emitted `Fetch API cannot load … due to access control checks`
while an automation-forced full-document navigation overlapped incoming live
refreshes. The trace shows previously successful same-origin reads and the
errors on the departing page's Audit/space requests; subsequent UI assertions
still completed. This is not claimed fixed or silently ignored. The everyday
acceptance flow now exercises the application's own navigation links, while
retaining direct-link and reload coverage for filter restoration. The failed
forced-navigation trace is retained in the earlier WebKit result folder.
