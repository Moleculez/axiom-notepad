# Lab planning · Stage 3 implementation

Stage 3 adds workspace metadata, not another document engine or navigation product.
Canonical Markdown, source-backed undo and Yjs state are unchanged. This increment
is implemented in source; **database, concurrent-worker, browser and lab-scale
acceptance are not yet certified**. See [verification](VERIFICATION.md) for actual
results and [planning](WORKSPACE_PLANNING.md) for existing schedule boundaries.

## Task properties

Workspace **Settings → Planning → Task fields** manages text, number/unit, date,
checkbox, HTTP(S) URL, select, multiselect and workspace-person fields. Managers can
create, rename, archive and reopen definitions. Types and UUID identities are
immutable. Used choices retain their identity even after a task clears a value;
archive them instead of deleting them. Archived definitions/values remain readable.

Experiment and Paper review presets show the five proposed fields before creating
them. Creation is atomic: a conflicting active name or exhausted quota creates
nothing. Presets never overwrite existing task values or silently enable rules.
Limits are 32 active/200 retained fields and 50 options per definition.

Task **Properties** contains the same native controls as application settings.
Numeric input keeps unfinished signs/decimal drafts instead of erasing them.
Scientific notation is supported; raw typing retains trailing decimal zeros and
the sign of a negative-zero draft instead of interrupting the next keystroke.
Not set, zero and false are different values. Missing people/options remain visible
as unavailable; they never become an empty save. Changing a task uses its original
task version; changing properties also requires the field-schema revision.

**Properties** in the planning filter row opens up to eight AND conditions and
eight selected columns, plus property sorting. List/Gantt, saved views and task
CSV include these selected properties. Summaries load only selected values: text
over 200 characters and choices beyond eight are explicitly shortened. Task CSV
columns are labeled previews, not an assertion of complete long values. Open the
task to read/edit the complete value. An archived filter fails visibly instead of
silently returning a wider task list.
Multiselect equality compares choice sets, not selection order. Empty values use
Not set explicitly. Invalid saved conditions are retained as an error until Reset
explicitly removes them; removing another filter cannot hide an invalid draft.

The canonical task map is `tasks.custom_fields`. `planning_field_values` is a
transactional, indexed SQL projection, not a second writer. Patches use UUID keys;
`null` clears, omission preserves. Existing task writers preserve custom values.
Metadata-only bulk updates share one bounded row read/update rather than loading a
dependency graph per item. That read omits full custom maps; SQL merges only typed
set/clear deltas, retaining unrelated values without copying them through the
application. Structural/dependency changes retain existing checks.

## Shared manual time

Planning **Time**, or the task inspector's **Time** panel, records a live task,
work date, 1–1,440 minutes and an optional note. Switching between Time/Properties
retains the task draft. Time is visible to workspace members, not an inferred
timesheet or billing feature. Future dates and cross-workspace tasks are rejected.

Authors create/edit their own entries. Current editors with management access can
correct another member's entry only with a reason. Entries carry original-version
fences; corrections, withdrawal and restoration keep full before/after history
and actor/reason audit. There is no hard-delete action for an individual log.
Deleted-task records remain readable and can be withdrawn/restored; ordinary
editing/creation requires a live task. A workspace purge retains its existing
reviewed destructive boundary.

The default report is the workspace's current Monday–Sunday week. Filters select
date range (up to 366 days), member, task, active/withdrawn/all and literal search.
Task totals are direct by default; **Include descendant tasks** explicitly rolls
up descendant entries, counting each entry once. Member/week reports and totals
cover the entire filter, not just the current page. These are creation-bounded
pages; later corrections remain live, not a frozen accounting snapshot.

Correction history supports literal note/reason search, oldest/newest order and
My changes, with precise continuation pages. It retains complete historical notes.

CSV explicitly loads complete notes in bounded pages. More than 10,000 matching
entries blocks the export before downloading a partial file. Spreadsheet-formula
prefixes are escaped. Narrow a large report rather than treating partial totals
as complete. Logs do **not** change task dates, estimates, progress, availability
or schedule revisions.

## Reviewed, non-AI automations

Settings → Planning → **Automations** configures rules; **Review queue** is shared
within the workspace. Rules start paused. Only editors with management access
configure/approve; current access is checked again on every operation.

Triggers: task creation, selected metadata changes, daily workspace-local time,
and Run now on an enabled rule. Conditions are ANDed (maximum eight); at most eight
actions propose status, priority, assignee, label or custom-property changes.
No scripts, webhooks, providers, body edits, dates, dependencies, deletion or time
creation. Limits: 100 retained/20 enabled rules, 100 tasks and 1.5 MiB per proposal.
Oversized proposals are blocked rather than truncated.

Draft and server validation share typed condition/value checks; unavailable fields,
unfinished numeric values and conflicting actions explain why a rule cannot save.
Workspace-person conditions/actions are checked against current access on save.

Task events enter a transactional, metadata-only outbox. Pending changes to one
task/kind coalesce from the first before-state to the latest after-state. Workers
use workspace-before-event/rule transaction-owned locks and deterministic event/day keys; proposals and
processed markers commit together. Superseded versions are identified/skipped;
Run now evaluates current metadata. A configuring manager losing editing/manage
access pauses the rule and records a blocked run. Apply/Undo never recursively
enqueue another automation event. None of these mechanisms changes Markdown.

Select exact proposed tasks, **Preview selection**, then **Apply reviewed changes**.
The preview belongs to the reviewer and expires after 15 minutes. Task versions,
rule version/state, field schema, selection and current permissions are rechecked;
any conflict blocks the whole selected batch. Unselected proposals stay in the run
record, explicitly labeled Not selected rather than Applied. Cancel leaves tasks unchanged. Undo reverses only applied items and refuses
intervening task edits or values no longer allowed by current definitions. Reload
confirmed state is explicit; peer refreshes do not silently replace the open review.

Native time/configuration/review are separate from owner-private assistant change
sets. MCP exposes scoped read tools for definitions, time and rule/run summaries.
Reviewed task updates can change typed fields, and their reviewed Undo restores
only touched properties. Time/rule writes and native approvals are not MCP/plugin
tools. New metadata is not automatically added to outgoing assistant context.

## Upgrade and verification

Forward migration **46** adds the metadata schema, projection/outbox triggers and
indexes. Back up the database **and** attachment store, stop old writers, migrate,
then restart matching web/sync/worker builds. Do not seed/reset existing data or
run mixed-schema services. Development acceptance never upgrades working data.

```sh
npm test -- --run tests/planning-lab.test.ts tests/ui-controls.test.ts
node --import tsx scripts/verify/planning-lab-migration.ts
npm run verify:reliability -- --grep='lab planning'
```

The offline SQL gate (`npm run verify:planning-lab:migration` where CLI IPC is
available) owns fresh local clusters and checks the normal migration
controller, 45→current/rerun (including migration 46), exact source/state preservation, projection, time isolation
and outbox coalescing. It does not certify HTTP or concurrent leases. The browser
suite is fail-closed to attested reliability staging, covers native controls,
draft retention, stale fields/time/approval, selected Apply and Undo, five styles,
light/dark, 22px UI, radius zero and forced colors/reduced motion. Screenshots must
be inspected, not only generated. Paired-recovery receipts include all new tables.

Outstanding acceptance: execute those database/HTTP/browser gates, two-worker
crash/lease/revocation/failure-injection rehearsals, permissions for another
member's corrections, daily/DST/cursor races, 5,000-row/20-workspace/100,000-task
same-host baseline comparisons (no >20% regression), paired recovery with populated
new records, keyboard/screen-reader checks and real screenshot inspection. Physical
IME/clipboard certification remains a separate editor gate. Stage 3 must not be
marked accepted until evidence supports these checks.

The [Stage 3–4 coordinator](STAGE_ACCEPTANCE.md) now implements these software
gates in one local command, with real PostgreSQL worker barriers, populated
recovery and an archived-source same-host scale comparison. Run
`npm run verify:stages:acceptance` under Node 24; a blocked receipt, focused browser
run or generated screenshot does not certify this stage. Operator review remains
explicit even after all software phases pass.
