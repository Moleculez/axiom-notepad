# File-first workbench

## Navigation and creation

All resources share a compact context toolbar, location breadcrumbs, sharing and a persistent navigation
tree. The canonical route is resolved by `packages/shared/src/file-routes.ts`:

| Resource                            | Path below `/workbench`                               |
| ----------------------------------- | ----------------------------------------------------- |
| Markdown note                       | `/notes/:id`                                          |
| Canvas, math, drawing, text project | `/canvas/:id`, `/math/:id`, `/image/:id`, `/text/:id` |
| Uploaded image, audio, video, PDF   | `/image/:id`, `/audio/:id`, `/video/:id`, `/pdf/:id`  |
| Office document, unsupported file   | `/document/:id`, `/files/:id`                         |
| Folder                              | `/explorer?space=:id&folder=:id`                      |

Studio and viewer implementations are file views, not separate navigation systems.
`?version=` preserves immutable-version intent. Legacy `/tools/:type/:id` routes
resolve to the same resource; canonicalization updates the active work session rather than
creating a duplicate. Old creation links open the shared New File dialog over
Explorer, carrying their destination and image-import parameters.

Explorer's New/background menu, sidebar folder actions and the legacy `/new` launcher use the same
creation path. Markdown, Canvas, Math, Drawing and Text appear at the same level;
less common text/data/Office formats are grouped. Current writable folders are
prefilled; otherwise the dialog requires a workspace choice. Creation is guarded
against double submission and uses the API's idempotency key. Completion in an
inactive work session does not redirect a different active page.

### Context toolbar and recent work

The application tab strip and separate breadcrumb row are retired. One toolbar
contains sidebar toggle, Back/Forward across pages, physical parent navigation,
authorized breadcrumbs, Recent work, search/commands, connectivity, Inbox,
transfers and the account menu. Specialized editing tools remain in their pages.

- `Command/Ctrl K`: search authorized files/tags; type `>` for destination commands.
  The fixed-height palette offers Everything/Files/Commands scopes, matched-name
  highlighting, workspace/type/modified-time context, and recent destinations.
  Arrow keys move selection without taking focus from the input; Enter opens the
  selected result. Escape returns focus to the invoking control. Pending searches
  never activate results from an earlier query.
- `Command/Ctrl Alt R`: open Recent work. Filter, pin/unpin, or open a file beside
  the current document. Escape closes the switcher and restores focus.
- Up to 100 recent locations and 20 user pins are device/account-local. Old tabs
  migrate to recent locations; old pins and safe view preferences are retained.
  Browser-lifetime Back/Forward history is separate from the recent list.
- Session metadata stores sanitized routes and bounded presentation fields, not
  document text, titles, credentials, settings drafts or invitation tokens.
  The recent switcher resolves known resource names from authorized recent files.
- Notes retain their existing local document/undo sessions across navigation.
  Only visible editor panes mount. Explorer restores view choices and scrolling
  after its rows load; Settings keeps its single in-memory draft after first visit.
  Reload does not preserve unsaved Settings drafts. Existing navigation and
  sign-out guards remain in force. Pruning recent metadata never deletes drafts.
- “Online” means network availability, not a successful save. For an active
  Markdown note the toolbar reflects the editor's reported synchronization state;
  each studio/reader keeps its own detailed save indicators.

## Sidebar and dialogs

One tree stays mounted across documents, Settings and administration. It contains
Quick access, saved views, Your spaces, then Workspaces/Groups/Audit/Trash. Current
file ancestors expand automatically. Workspace creation lives on Workspaces, not
as a permanent sidebar control. Settings and workspace/project section links live
inside their own pages.

The sidebar explorer has a local workspace-name/group filter, a collapse-all action,
and device/account-local expansion memory (resource IDs only). Authorized ancestry
reveals directly opened folders and documents. Compact rows use nested guides,
open-folder icons and an active marker; their overflow menus appear on hover or
keyboard focus. Up/Down and Home/End move between loaded rows, Left/Right traverse
branches, Enter opens the row and Shift-F10 opens its context menu. Resource loading,
permission checks, drag/drop and the full-folder handoff remain unchanged.

Use the shared native `Dialog`, `DialogBody` and `DialogFooter`. Header and actions
stay outside the scrolling body. A submitting form must own both body and footer;
never move its submit button into an unrelated wrapper. Align checkbox rows with
flex-row and fixed-size controls; field labels may use column layout. Escape,
close button and backdrop must use the same guarded cancellation path. Focus
returns to the original trigger, including Safari pointer activation. Use
`confirmAction` / `promptText` for application prompts, not browser alert dialogs.

Sharing explains effective inherited workspace access, has searchable/paginated
collaborators, selectable canonical links, explicit copying feedback and management
navigation when permitted. Copying never grants access. This is not public sharing
or a new per-file ACL model. The access endpoint rechecks authorization before
returning resource identity or member information.

## Loading and safety

Main pages and individual studio implementations load on demand. Opening a studio
fetches that resource, not the whole project catalog. Settings stays mounted only
after visiting it in the current account/session, retaining drafts without eagerly
starting an inactive restored Settings tab. Shared reads deduplicate only in-flight
requests by account/path/revision; permission-bearing results are not globally cached.
All readers release their own reference; the request aborts after the final reader
leaves, and account/document closure clears outstanding requests.

Markdown collaboration, resource IDs, storage formats, local recovery and immutable
file versions remain authoritative. No data migration or reset is required.

## Acceptance

`tests/file-routes.test.ts` covers routing, versions, anchors and restored-tab
metadata. `tests/e2e/file-first-workbench.spec.ts` covers all studio routes,
folder-aware creation, persistent sidebar/drafts, sharing and dialog geometry.
`tests/e2e/workspace-location.spec.ts` covers nested files and moved/renamed folders.
Use an isolated staging database/storage profile; never run these mutation suites
against working research data. Generated screenshots and traces remain untracked.

### September 13 verification

- Typecheck, lint, production build, theme validation and documentation checks passed.
- Unit suite: 1,567 tests across 61 files.
- Editor lab: 367 Chromium tests; 28 additional focused Firefox/WebKit tests.
  The opt-in large-document input-to-frame benchmark was not run.
- Production staging: 21 Chromium checks covering file views, creation, sharing,
  sidebar persistence, settings, layouts and folder navigation; the six file-view
  and real-math-worker checks also passed in Firefox and WebKit (33 total).
- The real equation worker test recorded zero raw-preview resets during typing,
  then verified server persistence and reload. Screenshots were inspected from
  this run, including the metadata table, sharing dialog and Appearance split panes.

Production screenshots are under `test-results/file-editor-production-final/`,
with the Firefox/WebKit runs in their corresponding named output folders. Editor
results are under `data/editor-final-chromium/` and
`data/editor-final-cross-browser/`. These are generated local artifacts, not
committed release assets. Physical IME/clipboard and assistive-technology checks
remain separate manual acceptance gates; browser automation does not certify them.
