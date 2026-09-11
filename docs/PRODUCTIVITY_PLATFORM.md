# Canvas, Explorer, connections and selected offline work

September 11, 2026. This extends the existing research workspace; it is not a
claim of complete Obsidian Canvas, Google Drive or Office parity.

## Creation and application tabs

Creating a Math, Image, Canvas or Text project replaces its **Create project**
tab and the current entry in that tab's history. The tab identity, order, group
and pin are preserved. Completion in a background tab changes only that tab;
closing the creation tab or navigating elsewhere while saving never replaces an
unrelated page. Image import file/version parameters survive the replacement.
New drawings contain a valid blank, downloadable image-project version immediately.

## Native Canvas

Open Research tools → Canvas, or Explorer's blank-space context menu → Research
file → Canvas. Text/Markdown, file, web-link and group cards use the JSON Canvas
1.0 interchange format, with supported custom metadata retained on import/export.
Native files use the existing workspace permissions, Trash, discussions, snapshots,
application tabs and durable synchronization service.

The board supports pan/zoom, fit, search, minimap, selection, multi-card/group
movement, resizing, labeled and colored edges, connection handles, card ordering,
duplicate, delete and author-local undo/redo. New dock-created cards avoid covering
existing cards. Markdown cards render research mathematics; file cards retain
resource/version identities. Collaborative cards and edges use property-level
Yjs maps; editable card text uses Y.Text rather than replacing an entire JSON blob.
Imports and automation commands validate the complete candidate document before
applying a transaction. Duplicate IDs, dangling edges and invalid commands fail.

Text cards render on load, including headings, tables and mathematics, without a
focus/blur cycle. Double-click a card to use the same rich-editor adapter as the
Appearance scratchpad. Its compact Write/Source controls and `Mod-/` shortcut
operate on the card's nested Y.Text with collaborative carets and local undo.
Escape finishes editing after dismissing active editor overlays. Inactive cards
use lightweight rendered previews. Double-clicking within the editor selects text;
blank-board double-clicks do not create cards. Use N, the dock or context menu.
Card dragging starts after a movement
threshold so it cannot intercept those clicks. Main note/scratchpad behavior is
unchanged, and no additional editor dependency is introduced.

The v1 Canvas platform adds names/tags, card links and discussions, research
templates, smart height, manual sizing/locks, alignment/distribution, clipboard
interchange, actual endpoint sides and keyboard reconnection. File cards follow
latest or pin a stored version, with rich native/media/Office/nested previews.
Webpage embeds are explicit, sandboxed and restricted. Exports include
PNG/JPG/SVG/PDF, Markdown, JSON Canvas and snapshot-bound portable ZIP bundles.
See [the implementation boundaries](CANVAS_ARCHITECTURE.md).

Current limits: 2,000 nodes, 8,000 edges and bounded text/dimensions; visual export
is limited to 120 cards and 32 megapixels per raster. Group background images,
arbitrary embedded app permissions and every Obsidian interaction are not implemented.
Physical OS IME and large, real research boards need further acceptance testing.

## Explorer and native file formats

Blank-space menus and keyboard submenus create folders, Markdown, Canvas, equations,
drawings, text, CSV, JSON, YAML and valid blank DOCX/XLSX/PPTX files. Office files
use the existing preview pipeline, not an Office editing engine. Drawings open
Image Studio; text/data files open the collaborative Text Studio.

Selection starts with a small drag threshold in blank space, supports modifier
keys and autoscroll, cancels with Escape and clears on a blank click. Existing
file dragging, scoped move/copy, keyboard selection, safe batch operations and
Trash remain available. Details follow selection, show native types and file
locations/previews, and have an account-scoped resizable width (including keyboard
resizing). Menus share icons, separators, focus behavior and the existing palette.

Workspace ZIP exports and individual native-document downloads preserve source
formats. The legacy notebook group archive/import remains Markdown-only: export
refuses groups containing native studio documents instead of labeling JSON/LaTeX
as Markdown. Use Workspace management export for those groups. This is not yet
a single round-trip archive importer for every new project type.

## MCP connection setup and authority

Point a compatible MCP client at `https://YOUR_HOST/mcp` (local development:
`http://localhost:8080/mcp`). The endpoint publishes OAuth resource/authorization
metadata and supports the SDK's JSON-RPC protocol negotiation. Connect using the
browser OAuth flow, choose the allowed workspaces and grant only needed scopes:
`workspace:read`, `workspace:write`, `workspace:manage`.

Settings → Connections lists grants, calls and pending approvals. Current tools
cover workspace/file discovery, search, native documents, Canvas commands, file
operations, projects, tasks, discussions, groups/invitations, workspace lifecycle,
Trash and audit reads. The advertised `tools/list` is the exact supported catalog;
binary uploads/downloads, complete PDF annotation/reference workflows and all
Math/Image Studio manipulation are not exposed yet.

Tools reuse the same authenticated business handlers as the UI. Every action
rechecks workspace scope and current account permissions. Grants are bound to the
issued token's revision; revoking/recreating a grant cannot revive an old token.
Destructive/access-changing requests require a separate, in-app approval bound
to the exact arguments. An assistant cannot approve its own request or change the
approved arguments. Replays are idempotent. Native document edits go through the
live synchronization service with generation/hash checks and immutable receipts;
they do not overwrite the document database behind connected editors. Queued
workspace operations retain integration attribution and recheck grants on execution.

Consent and activity are not substitutes for trust in a connected client: content
returned to that client leaves the app's boundary. Review its identity and scopes.
An approval interrupted while executing may require manual recovery; automatic
retry of indeterminate destructive operations is deliberately limited.

## PWA and offline use

The production build includes an installable manifest, icons, a neutral offline
shell, bundled editor assets/fonts and a controlled update prompt. Service-worker
caching is disabled in the development server to avoid stale development code.
Build with `npm run build`; use HTTPS or localhost. Browser install availability
depends on the browser, with manual installation guidance when needed.

In Explorer, choose **Available offline** on selected work. Settings → Offline
research shows downloaded packages, progress, device storage and queued actions.
Only explicitly selected private metadata/files are stored in this offline cache;
ready status requires durable document journals and verified file downloads.
Downloads are currently bounded to 500 resources and 512 MB per selection.
Current file bytes/previews are downloaded, not every historic file version or
remote website. Existing editor journals remain the source of local draft recovery.

Offline work supports downloaded documents plus queued native file/folder creation,
rename/metadata edits, same-workspace moves and Trash. New documents use the same
initial CRDT identities during offline creation and server replay. Reconnection
replays in order with version and permission checks. Conflicts pause the queue;
the UI can compare server values, explicitly reapply requested fields to a reviewed
revision, retry an unchanged request, or export recovery and stop pending operations.
Recovery includes selected originals, metadata, operation records and retained
document generations. Stopping operations does not undo changes already accepted
by the server or erase editor journals. Refresh selected downloads afterwards.

Office/drawing creation, cross-workspace transfers, bulk copy/drag jobs,
administration, permanent deletion and unselected content remain online-only.
Access is revalidated when opening/synchronizing online; copies cannot be remotely
erased while disconnected. Sign-out/account switching isolates device caches.
Browser storage is not a backup: export important work and request persistent
storage where supported. Multi-tab replay requires Web Locks.

## Verification and deployment boundaries

The expanded Canvas v1 candidate, theme packs and authorized clean development
reset are recorded in [current acceptance](CANVAS_V1_ACCEPTANCE.md). Its tests use
separate port-3004 storage/database; the port-3002 results below are historical.

Migrations 16 and 17 are forward-only and were applied after a verified local
database/blob backup. Acceptance uses the isolated database and attachment root
configured by `scripts/run-management-staging.ts`, web port 3002 and sync port 1235. Never point mutation or fault-injection tests at the live workspace.

The live development service stays on 8080. Production-only PWA behavior is
verified against the separate staging build; no production cutover is implied.
The new acceptance suite is `tests/e2e/canvas-platform.spec.ts`; existing research
tool, management, context-menu and breadcrumb suites provide regression coverage.
See the latest test report for exact results rather than historical screenshots.

Run the isolated browser acceptance with the candidate engine flag as well as the
test origin. The older editor/settings suites deliberately reject a mismatched
engine or select engine-specific controls:

```sh
TEST_APP_URL=http://localhost:3002 NEXT_PUBLIC_AXIOM_EDITOR_ENGINE=milkdown \
  PLAYWRIGHT_HTML_OUTPUT_DIR=playwright-report/platform-current \
  npx playwright test tests/e2e/canvas-platform.spec.ts \
  tests/e2e/research-tools.spec.ts tests/e2e/desktop-management.spec.ts \
  tests/e2e/menu-icons.spec.ts tests/e2e/workspace-location.spec.ts \
  tests/e2e/editor-vnext.spec.ts tests/e2e/productivity-settings.spec.ts \
  --output=test-results/platform-current
```

### Previous platform baseline

Build `D71PVaBNbAmmRmj72IEwL` in `.next/management-console-20260911` passed the
production build, TypeScript, ESLint, formatting checks and all **1,456 unit /
conformance tests**. The final isolated Chromium run passed **39 tests without
skips or retries**: creation tabs (including background completion), collaborative
Canvas and rich cards, Explorer selection/details, OAuth/MCP approval and revocation,
native exports, offline reload/create/conflict/recovery, editor/settings and the
existing management/research-tool/file workflows. A separate read-only browser
smoke passed against the live development service on **8080**.

Both focused Canvas scenarios (collaboration/undo/dragging and rich-card
rendering/mode switching/double-clicking) also passed in **Firefox and WebKit**,
two tests per browser. Their current artifacts are in
`test-results/platform-firefox` and `test-results/platform-webkit`. These are
automated browser-engine checks, not physical Safari, IME or clipboard acceptance.

Current Chromium screenshots/traces are in `test-results/platform-current` and
the HTML report is `playwright-report/platform-current/index.html`; the live
tool-page screenshots are in `test-results/latest-dev-8080`. Earlier partial runs
are not substitutes for this acceptance result. The build no longer evaluates
the legacy browser editor during server rendering or reports duplicate Yjs imports.
