# Productivity release — September 2026

> Historical September 9, 2026 acceptance record, including the then-current
> native editor and administration layout. For today's behavior, use
> [Settings](SETTINGS.md), [the management console](MANAGEMENT_CONSOLE.md),
> [the current editor](EDITOR_VNEXT.md) and [Verification](VERIFICATION.md).

## Interface criteria

- Use the shared semantic palette, typography and focus tokens. Quiet input surfaces still need visible keyboard focus; destructive actions need plain-language confirmation.
- Keep settings drafts separate from committed preferences. Incomplete numeric/color text stays local, valid committed values drive previews, and Apply remains the persistence boundary.
- Prefer contextual controls over permanent editor chrome. Settings scratchpads use the native editor with in-memory Yjs only: no note identity, synchronization provider, persistence, uploads, links or image loading.
- Admin navigation is Overview → Members → Invitations → Activity → Settings. Group administration and document-content permissions are separate concepts, named separately in the UI.
- Trash always has an explicit workspace scope. Page selection is distinct from all matching results; preview shows deduplicated descendants and blockers before confirmation.

## Implemented workflows

Reading positions and bookmarks use a finite unit fraction, including overscroll and document reflow. Invalid queued reading items are isolated with their local data retained and a targeted retry/export path. Reading-progress errors do not change document save status.

Account recovery keeps its success confirmation mounted after the old session is revoked, removes the recovery token from the URL and clears the password field.

Theme settings provide semantic color groups, native visible swatches, HEX/RGB entry, copy/reset, paired light/dark previews and contrast warnings. Numeric values can be cleared and retyped. Editor, table, code and math settings include a temporary editable scratchpad. Like the main editor, that preview is client-only: its DOM/Yjs engine is excluded from server rendering, avoiding duplicate server imports.

Group administration includes searchable/paginated memberships and invitations, cross-page selection, individual/bulk content roles and guarded removals, ownership transfer, multi-email invitations, token-rotating reissue, revocation, delivery/copy-link results, activity filters, versioned metadata and existing storage/lifecycle controls. Last-project-lead, owner/admin and personal-workspace boundaries remain enforced.

Trash supports cross-page selections, scoped all-matching actions, original locations, restore/permanent-delete previews, durable background execution, results, cancellation and retries. Each operation freezes IDs/revisions. Existing hierarchy and file-reference edges form atomic units. Retaining an item also retains its file dependencies and necessary ancestors. New, changed, restored or newly protected items are not silently deleted. Physical deletion uses the existing post-commit, usage-checked blob cleanup.

## API / migration notes

- Migration 9 adds membership revisions, invitation content roles/revocation metadata and durable Trash operation/item records. No Markdown, document generation, Yjs, preference or attachment-URL format changes.
- `GET group-admin/:groupId/{overview,members,invitations,activity}`; collections accept `q`, `filter`, `offset`, `limit`.
- `PATCH group-admin/:groupId/members`: mutation ID, `{id,version}` targets, role/content-role change or guarded removal; per-item results.
- `POST group-admin/:groupId/invitations[/reissue|/revoke]`: bounded batches; new invitations accept default content role. Tokens are never stored in activity or mutation replay records. Replaying a processed create returns no old secret; reissue obtains a fresh link.
- `GET trash/items`: explicit `spaces`, `q`, `kind`, `offset`. `POST trash/preview`: explicit workspace IDs, selected IDs **or** all-matching criteria, action and mutation ID.
- `GET trash`, `GET trash/:id`, and `POST trash/:id/{confirm,cancel,retry}` expose account-owned progress/results. Permanent deletion requires `DELETE FOREVER`; authority is checked again during execution. Retrying never repeats completed items or adds new targets.
- Existing single-item APIs remain compatible. Validation responses retain the string `error` and additionally expose field errors.

## Verification and operational boundaries

All mutation/fault-injection tests require the isolated port-3002 application, test database and test attachment directory. `scripts/verify/verify-productivity.ts` covers protected evidence, pending CRDT journals, worker interruption/lease rotation and repeat-safe completion. `scripts/verify/rehearse-productivity-migration.ts` restores a fresh backup into a new database and compares research/state/file/history/preference fingerprints across migration 9.

Do not run destructive tests against the live database. Keep previous release assets/builds and a freshly verified database/blob backup when applying migration 9. Live acceptance is read-only; do not overwrite newer user content with a rehearsal backup.

Not introduced: mobile redesign, another editor framework, public sharing, commerce, new research modules, transparent theme colors, merged table cells or spreadsheet formulas.

## Verified local release — 2026-09-09

- Active build: `.next/productivity-release-r12e-20260909` (`Ju6qHYWo4upPmaBipxxR6`), serving on port 3001 with migration 9. The existing port-1234 collaboration process stayed running during the web/worker cutover.
- Type checking, lint, all 854 unit tests and both isolated/live-config production builds passed.
- The final isolated production Chromium regression run passed 79 tests across editor input, collaboration, research, settings, account menus, tree navigation, administration and Trash. Focused Firefox and WebKit runs each passed 12 tests before the client-only preview adjustment; all three settings tests then passed again in each of Chromium, Firefox and WebKit on the final build, including a duplicate-Yjs-import console guard. The adjusted Chromium accessibility check also passed.
- The forced-color CSS override is asserted only where the browser implements `forced-color-adjust`. Swatch visibility and dimensions remain tested in every engine, including WebKit, which does not implement that property.
- Migration rehearsal preserved note, CRDT state/journal, attachment, snapshot and preference fingerprints. Isolated safety checks passed for retained research evidence, cross-space review dependencies, uploads/new references, pending journals, interrupted workers, lease rotation and repeat-safe completion.
- Verified backups: `data/before-productivity-cutover-r12d-20260909` before migration, and `data/before-productivity-cutover-r12e-20260909` before the final UI cutover. Database and all five stored-blob checksums passed verification in both. This is private account/research data; keep it local or encrypt it before off-host storage.
- All 705 previously served asset paths are retained in the new 715-asset offline manifest, including the 687 assets from the earlier account-menu release. Both `.next/account-menu-release-r11b-20260909` and `.next/productivity-release-r12d-20260909` are preserved. A UI rollback must not restore an old database over newer user work; migration 9 is additive.
- Read-only live acceptance verified all 21 color controls, editor-preview mounts, pinned settings/editor footers, five administration sections, scoped Trash and the live synchronization connection without browser errors. Separate checks confirmed profile-menu dismissal/focus and workspace/project tree expansion. No editor input or content/preference/group/file API writes were used for live acceptance. The isolated staging web, sync and worker processes were stopped after verification.

The final server log was also checked after live acceptance: the duplicate-Yjs-import warning is absent. When retiring a web process, an existing event stream can outlive its listening socket; allow requests to drain and check for active database transactions before terminating that old process. The independent collaboration server must remain untouched during this UI-only cutover.

Browser artifacts are under `data/productivity-r12e-chromium`, `data/productivity-r12e-{chromium,firefox,webkit}-settings`, `data/productivity-webkit-release`, `data/productivity-firefox-release` and `data/productivity-live`. These directories may contain private screenshots/traces and are not distributable release assets.
