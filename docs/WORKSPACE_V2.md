# Workspace reliability and desktop workflows

Desktop implementation and verification, 2026-09-10. This is an everyday
research-workspace release, not a claim of complete Google Drive or Chrome
feature parity. Research permissions, Markdown, file identities/versions and
recovery artifacts are preserved.

| Capability                                  | Baseline                                                         | Current acceptance                                                                                                                                                                |
| ------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create/join group hub                       | Broken entry route; creation under settings; implicit acceptance | Browser create/admin handoff, explicit acceptance, decline and consumed-link safety pass                                                                                          |
| Member/admin/lifecycle operations           | Implemented, needs end-to-end regression                         | Existing administration/Trash API regression passes                                                                                                                               |
| Trash bulk restore/purge                    | Implemented, indexing waits and recovery need work               | Frozen all-page selection, permission/revision rechecks, cancellation/retry and protected references pass; original-folder/root restore choice and unopened journal recovery pass |
| Multi-file move/copy and internal drag/drop | Single-item dialogs; upload-only drops                           | Native browser drag, range selection, stable double-click opening, idempotent retries and revision checks pass                                                                    |
| Folder uploads, bulk rename, quick preview  | Partial or missing                                               | Native directory chooser preserves hierarchy; keep-both/merge/skip planning, rename extension preservation and text preview pass                                                  |
| Shortcuts and personal folder colors        | Missing                                                          | API checks pass, including no shortcut chains and personal color isolation                                                                                                        |
| Persistent application tabs                 | Document-only working set                                        | Routing/privacy/migration units pass; browser pin/reopen, per-tab back, column retention, editor undo and split-pane commands pass                                                |
| Consistent settings/control geometry        | Shared tokens, inconsistent layouts                              | Desktop large typography, light/dark/reduced motion, centered management dialogs and retained settings drafts pass                                                                |
| New neutral/tonal theme families            | Missing                                                          | Six paired families; all 28 themes pass contrast and format checks                                                                                                                |

Agreed: invitation-only groups, inherited workspace/project access, protected
research evidence and desktop-first file workflows. Window material remains
functional under Advanced appearance as Navigation surfaces.

## What changed

- `/workbench/groups` is the create/join hub, including email-bound pending
  invitations and explicit link acceptance. Creating a group opens administration.
- Application tabs replace both the old page navigation and document working-set
  tabs. They support independent location history, pin/reorder, duplicate,
  named groups, close others/right/all, search and reopen. Close all includes pinned
  tabs, respects unsaved-work guards, and leaves a fresh New tab when everything
  closes. `Command/Ctrl + Alt + T/W`
  creates/closes a tab; add Shift to T to reopen; Alt + digits selects tabs.
- The location bar resolves authorized resource ancestry, including directly
  opened notes, versioned files and Math/Image Studio projects. Workspace and
  ancestor links open actual Explorer locations; Up opens the physical parent.
  Paths refresh after moves/renames and scroll horizontally when long. Legacy
  `/notes` and `/files` collection links resolve to the corresponding all-items
  Explorer filter instead of requesting an undefined document. Tool file previews
  are borderless; internal controls retain their functional separators.
- Only visible editor panes mount editing surfaces, at most two. Existing Yjs
  sessions retain undo. Settings keeps a single draft; its rich preview unmounts
  when inactive. Unsaved profile/notification forms remain in memory, and closing
  Settings warns before discarding them. Navigation metadata never stores drafts
  or invitation credentials.
- Explorer has native drag/drop, click/range/additive/marquee selection,
  double-click/Enter opening, Space preview, bulk move/copy/rename and recoverable
  trash. Selection actions appear only with selected items, replacing the normal
  search/filter toolbar in the same layout slot so file rows do not shift.
  Clearing the selection restores the normal toolbar; Clear and Escape from the
  actions return keyboard focus to the file list. List and grid share this behavior.
  Destination dialogs search and paginate folders. Filters include type, MIME,
  tag, date and size; list columns can be hidden/shown independently in each tab.
- Durable file operations record individual results, resume after interruptions,
  support cancellation/retry, and expose revision-checked undo for applicable
  changes. Cross-workspace actions confirm inherited access explicitly.
- Native directory uploads retain hierarchy and never overwrite existing file
  versions. Conflict choices are keep both, merge folders or skip matching folders.
  Shortcuts retain inherited access, disallow chains and never duplicate blobs.
  Folder colors are personal and account-synchronized.
- Trash offers explicit behavior when the original folder is unavailable: retain
  the item until its folder is restored, or restore to workspace root. Sync &
  recheck drains saved journals even for unopened current-generation notes;
  unavailable/unindexed journals and research evidence remain protected.

## Deliberate limits / follow-up acceptance

- Native Finder/Explorer dragging, external clipboard, IME and browser-specific
  interactions still need human acceptance on supported desktop systems.
- Folder uploads are bounded to 2,000 files/folders and 32 levels per batch;
  empty-only directories require New → Folder. File batches are bounded to 200
  selected roots. Large-transfer interruption/worker-crash soak testing remains.
- Tab groups are named labels, not Chrome's collapsible/color-coded group system.
  Per-location history does not retain a full independent editor caret/selection
  snapshot for every entry; Explorer pagination starts from the first page when
  reopening. Settings scratchpad contents are disposable when its tab is inactive.
- Undo is revision checked, not an unrestricted global rewind. Mixed-original-
  folder moves require explicit destinations; copied items can be trashed normally.
  A queued Cut is recovered through operation history/retry, not a durable clipboard.
- Text/image/note/PDF preview is bounded; unsupported files offer download/open.
  The protected full PDF reader regression passes; the new quick-preview canvas
  still needs dedicated multi-page/large-file browser acceptance.
- No public/per-item sharing, OCR, Office compatibility, commerce, mobile redesign
  or native desktop sync was added.

Verification must include isolated destructive/membership tests, browser
interaction and screenshots, migration rehearsal, existing editor regressions,
typecheck, lint, units and a production build. Do not run generated/destructive
fixtures against the live workspace. Source backup for this revision:
`data/workspace-v2-before-20260910.1UZo0Y/source.tgz`.

Live pre-migration backup: `data/workspace-v2-before-20260910.1UZo0Y/live-backup`.
Database and all eight stored attachment checksums verified. Migration 10 was
rehearsed on the isolated refinement database before application to the live
database. No live records were deleted. New file operations, shortcuts and folder
colors use additive metadata; existing document/file identities are unchanged.

Migration 11 adds the explicit restore policy. It was rehearsed on the isolated
database before live application, with a second checksum-verified backup at
`data/workspace-v2-before-20260910.1UZo0Y/restore-policy-backup`.

## Verification evidence

- 1,365 unit tests / 43 files; TypeScript, ESLint and a Milkdown production build
  pass. The default production editor switch must be explicitly set to Milkdown
  when building an isolated candidate.
- Final desktop acceptance: 38/38 pass on the latest isolated Milkdown build
  (`data/workspace-v2-tests/verified-desktop/`), including revision-checked
  Trash undo/restore. These runs cover membership/admin, inherited lifecycle access,
  protected Trash, account menu dismissal, settings panels, desktop typography,
  native file dragging/directory uploads, app tabs and research editor regressions.
- The 15 collaboration/privacy/offline scenarios pass; all five targeted vNext
  editor scenarios pass after updating the stale code-language textbox selector
  to the current accessible combobox.
- `npm run test:dev`: 19 read-only live checks pass on 8080. Fresh screenshots,
  including all six paired theme families, are in `test-results/latest-dev-8080/`;
  report: `playwright-report/dev-service/index.html`. No live research/preferences
  were changed by visual acceptance.
- Isolated artifacts are in `data/workspace-v2-tests/`. Earlier failed attempts
  are retained as debugging evidence; they are not the latest live screenshot set.

### Breadcrumb, preview and selection follow-up — 2026-09-11

- TypeScript, ESLint and the production build pass; 1,430 unit tests pass,
  including 19 new location/collection-route regressions.
- Fifteen new browser checks pass (five each in Chromium, Firefox and WebKit):
  three-level folder ancestry, direct/versioned file links, note collection links,
  physical-parent Up navigation, per-tab Back/Forward, folder moves/renames,
  legacy collection bookmarks, studio project locations and private/Trash ACLs.
  They also cover conditional selection actions, stable list/grid positions,
  checkbox/select-all changes, Clear/Escape focus and double-click navigation.
  Borderless previews, nested breadcrumbs and before/after selection screenshots
  are in `data/workspace-location/selection-{chromium,firefox,webkit}-verified/`.
- The existing Explorer range-selection/native-drag/tab-history regression passes
  (`data/workspace-location/explorer-drag-verified/`). The focused read-only live
  toolbar check passes on 8080, with a fresh no-selection screenshot in
  `data/workspace-location/live-selection-8080/`.
- The current read-only 8080 run passes 23 checks. The remaining seed-note check
  cannot run because its existing seed workspace is in Trash (the API correctly
  returns 404). No live workspace was restored or recreated to satisfy a test.
