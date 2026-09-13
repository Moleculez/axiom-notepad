# Desktop editor and workspace management

> Historical pre-vNext desktop release record. The framework-free dependency
> statement and editor interactions below describe that version, not today's
> default. Use [the current editor architecture](EDITOR_VNEXT.md),
> [typing contracts](TYPING_INTEGRITY.md) and [Verification](VERIFICATION.md).

This release continues the first-party editor, without Tiptap, CodeMirror or another editor framework. The installed Typora was used as a visual reference; these are tested Typora-inspired interactions, not a claim of complete compatibility or physical-keyboard/IME certification. Mobile development is explicitly deferred.

## Editing

Inline live preview replaces whole-paragraph source reveal. Structural deletion unwraps before merging, preserves literal code/TeX, joins nested literal lines without leaking quote/list prefixes, and navigates table boundaries without silently removing rows. Held-key, Unicode, composition, paired delimiters, source switching and concurrent-edit regressions check both canonical text and exact caret mapping. Code controls use a reserved bottom corner, equation controls remain hover/focus-only, and each pane retains its anchored footer.

## Explorer

The sidebar, Explorer and inspector share workspace/resource actions and the existing context-menu portal. Workspace menus provide creation, rename, member/settings navigation, archive/trash/recovery and owner management. File menus provide open/beside, rename, copy/cut/paste, move/copy across workspaces, duplicate, favorite, links, export, properties, version history and guarded Trash operations. Folder menus also create and upload within that folder. Cross-workspace operations confirm the destination audience. Keyboard actions are scoped to Explorer, preserve menu focus, and do not intercept editor inputs. Bulk failures retain unsuccessful items.

## Workspace lifecycle

Migration 8 adds lifecycle metadata and durable lifecycle events/tombstones; it does not rewrite Markdown, CRDT state or individual resource-trash state.

- Archive is read-only: reading/export remain available; editing, uploads, shared-reference changes, invitations, project creation and scheduled task work pause.
- Team archive/trash applies to projects through inherited state. Restoring the team preserves each project's independent archive/trash state. Restoring a workspace does not restore individually trashed items. Resuming recurrences skips the paused backlog.
- Team owners/admins may archive; only owners may trash a team. Project managers may archive/trash a project. Only the current group owner may request permanent removal. Personal space is protected.
- Trash has no expiry. Permanent removal requires the exact workspace name, a current revision and reference checks. It is queued with a 30-second cancellation window and can be cancelled until removal starts. Worker attempts recheck authority, version and references; failed work remains recoverable. A later confirmed attempt resets the old lease/payload safely.
- Outside note/file references, retained reviews, paper annotations, citation evidence, reading records and unfinished uploads/exports can block removal. Physical blob deletion happens only after database ownership/removal checks and a separate unused-blob check.
- Personal Markdown/CRDT and files moved elsewhere survive a group purge; citation metadata for detached private work is retained. Tombstones and lifecycle events outlive the removed space. Empty or already-completed purge retries are idempotent.

## Collaboration and local recovery

Accepted updates hold a workspace access lock until their journal transaction completes. Snapshot persistence and update application serialize per room. Signed access epochs detect workspace archive/trash cycles even if an offline browser missed both transitions. Old caches are quarantined, not silently replayed; their original IndexedDB journals and separate readable recoveries remain on device. Multiple recovery drafts are selectable for download and never overwrite one another. Cache rotation stops if its recovery cannot be retained safely. Server-save status requires both update acknowledgement and durable snapshot confirmation; memory-only/device-storage failure remains explicit.

After a restrictive lifecycle transition, synchronization requires the recovery-aware client (`accessProtocol: 1` on token requests). Older tabs receive an update-required error with instructions to retain unsaved text and reload; they cannot bypass cache quarantine by reconnecting after the workspace is restored. Temporary network/503 authorization failures leave local editing available and retry without treating the outage as revoked access.

## Verification and limits

Use the isolated helper in `data/editor-verification.mjs`; never run fixture mutations against live research. `tests/space-lifecycle.test.ts`, `tests/native-deletion.test.ts`, the three-engine native input harness, application editor/context-menu/lifecycle suites, `scripts/verify/verify-space-lifecycle.ts` and `scripts/verify/verify-durability.ts` cover these contracts. Final measured results and local deployment status belong in [VERIFICATION.md](VERIFICATION.md).

Physical Typora keystroke parity, OS IME/assistive-technology certification, complete CommonMark nesting equivalence and every possible concurrent edit interleaving remain outside these automated checks. The earlier intermittent rapid WebKit settings-navigation report is not declared fixed solely because isolated repetitions pass.
