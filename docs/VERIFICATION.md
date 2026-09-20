# Current verification and beta release gates

Updated September 20, 2026. Historical logs are [archived separately](archive/VERIFICATION-2026-09-11.md).
Do not treat historical browser totals or local build IDs as current release evidence.

## September 20 PDF roadmap stage

- TypeScript, ESLint, **1,830 unit tests across 88 files**, documentation checks and
  an isolated production build pass (**923 offline assets**). Unit coverage includes
  drawing/schema bounds, native/stable export deduplication, page layout/alignment,
  explicit annotation mapping, replacement fences and OCR configuration/contracts.
- Four scenarios pass in **Chromium, Firefox and WebKit** on isolated **3004**:
  existing reader/portable annotations; replacement races and recovery, thread
  privacy/idempotency and atomic mapped copies; generated mixed-size 1,000-page
  virtualization, arrow creation, reply CRUD, comparison navigation and saved copy;
  and OCR review/equation preview/private-note creation with mocked OCR transport.
- New checks jump through an internal PDF link to an unmounted page and deliberately
  lose an accepted upload's completion response. Retrying uses one upload identity
  and saves one copy. Fresh private evidence is in `test-results/pdf-stage-final-*`
  and the updated legacy-reader reruns in `test-results/pdf-reader-final-*`.
  Legacy-reader tests now reopen the deliberately dismissed options panel instead
  of relying on it remaining open behind the organizer. OCR screenshots are
  explicitly labeled as transport-mocked, not recognition proof.
- The OCR interface scenario also exercises real browser text comparison against a
  second file with an inserted page. It caught a reader-options dismissal issue;
  modal actions now dismiss that panel and restore focus to its stable trigger.
- `scripts/verify/rehearse-pdf-ocr.ts` passes against the real isolated PostgreSQL
  database/storage with a local mock processing server: durable page checkpoints,
  cancellation/resume, idempotency, searchable output retention, review conflicts,
  requester-only access, clearing results and unchanged source bytes. Three Python
  gateway contract tests pass. No real OCR model/provider was invoked.
- Local migrations 26–27 were applied only after creating and verifying the local
  development DB/storage backup (21 attachment checksums). Direct web **8080** and
  sync **1234** health endpoints respond successfully. No production migration,
  deployment, commit or push was performed.

The CPU OCR images/models still require Docker provisioning, real recognition,
resource-limit, cancellation and restore acceptance; Docker was unavailable here.
See [OCR setup](SELF_HOSTED_OCR.md). Desktop-reader drawing appearance/Unicode free
text, durable offline reply drafts, native-arrow import, generic text/area geometry
editing and broader real-document/accessibility/revocation testing remain gated.
Unified AI and advanced planning are subsequent roadmap stages, not claimed done.

## September 20 compact menus, PDF portability and Office reading

This increment implements part of the [productivity roadmap](PRODUCTIVITY_ROADMAP.md),
not the entire assistant/planning expansion. Original files remain immutable.

- TypeScript, ESLint, **1,813 unit tests across 84 files**, documentation-link checks
  and an isolated production build pass. New unit tests cover menu action retention,
  PDF geometry/schema/import/export/hash protection, safe OOXML extraction, slide
  ordering, Excel cached values/styles/merges and clipboard range safeguards.
- Five dedicated scenarios pass in **Chromium, Firefox and WebKit** on isolated
  **3004**: file/folder/workspace/Trash menu icons, root limits, category keyboard
  navigation and restored focus; Excel formulas/ranges/sort/filter/merges/virtual
  scrolling; Word outlines/tables/inert text/comments/export; PowerPoint slide order,
  hidden labels/notes/search; and the extended PDF reader workflow.
- PDF acceptance now imports a generated native underline, verifies private
  persistence and repeat-import skipping, reopens annotated downloads, verifies
  private-export opt-in, tags, cross-page strikeouts, and intra-page resume after
  reload. It still checks arranged-copy export and unchanged original bytes.
  Resume testing caught and fixed asynchronous page sizing and Strict Mode frame
  cleanup bugs. Workbook browser testing caught and fixed null sheet-view settings.
- Three existing Chromium discovery regressions also pass. Fresh private evidence:
  `test-results/productivity-{chromium,firefox,webkit}` and
  `test-results/pdf-portability-{chromium,firefox,webkit}`. The Chromium workbook
  scenario additionally reopens a version-pinned link into a merged cell.
- Word/PPT reading does not require a provider. Actual private LibreOffice rendering
  was not exercised, and no external AI/OCR call, production deployment, commit or
  push was performed. Annotated-PDF compatibility was checked with PDF.js/pdf-lib,
  not every desktop PDF application. Full screen-reader/physical clipboard, mixed
  page-size/password/CJK, large-document and offline/revocation rehearsals remain.

The later PDF stage above supersedes this increment's unfinished PDF implementation
list. Unified workspace AI, critical path/capacity/baselines and advanced automations
remain follow-up work. Office surfaces are **viewers**, not Office editing engines.

## September 20 search palette and sidebar refinement

Search now uses a scoped, fixed-height command palette with retained query focus,
keyboard selection, highlighted file names, location/type/time context and clear
loading/empty states. Sidebar rows have quieter hierarchy guides, active markers,
hover/focus menus, workspace filtering, collapse-all and account-local expansion
memory. Direct folder paths reveal their authorized ancestors.

- The three dedicated discovery scenarios pass in Chromium, Firefox and WebKit
  on isolated port 3004. They cover scope/prefix behavior, initial/restored focus,
  keyboard selection, empty results, stable input positioning, dark colors with
  22px dialog typography, direct-folder ancestry, filtering, menus, branch
  navigation and restored expansion. Screenshots are under
  `test-results/workspace-discovery-{chromium,firefox,webkit}`.
- TypeScript, ESLint, 1,798 unit tests, documentation checks and the isolated
  production build pass. Existing toolbar/time-zone acceptance also passes.
- Search styles are separately namespaced; editor command-palette styles are not
  replaced. No commit, push or deployment was performed for this refinement.

## September 20 context toolbar and time-zone autocomplete

Application tabs and the separate location row have been replaced by one context
toolbar. Global history and bounded recent work are independent; prior pins/view
metadata migrate without serializing drafts or credentials. The shared time-zone
combobox is used by profile, workspace-calendar and legacy project fields.

- TypeScript, ESLint, **1,798 unit tests across 81 files**, documentation links and
  the isolated production build pass (**913 offline assets**).
- **Nine Chromium scenarios** pass for nested/authorized breadcrumbs, parent and
  global history navigation, versioned-file paths, selection actions, pinned recent
  work, command destinations, time-zone keyboard/mouse selection, invalid values,
  retained Settings drafts, filter-input focus and saving the workspace's IANA calendar zone.
- The toolbar and profile time-zone scenarios also pass in **Firefox and WebKit**.
  Fresh screenshots are in `test-results/workspace-navigation` and
  `test-results/workspace-toolbar-{firefox,webkit}`.
- Chromium regressions pass for note-local Undo after navigation, split-pane
  shortcuts, and Workspace Files list/grid/inspector scrolling, including returning
  to the previous scroll position after opening Inbox.
- Maximum typography, dark mode, reduced motion and forced-colors shell checks
  pass at desktop widths in Chromium.
- Shared-dialog creation/handoff for math, image, canvas and text files also passes
  in Chromium without retaining a creation page in Recent work.

Checks use isolated port **3004**, not production/user files. No commit, push or
deployment was performed for this change. Real assistive-technology use and a full
application-wide browser suite remain outside this acceptance pass.

## September 20 PDF reader redesign

The [PDF reader guide](PDF_READER.md) separates implemented workflows from the
remaining Zotero-style features. Existing Workspace/Gantt changes and research
data were preserved; no commit, push, provider call or external deployment was
performed.

- TypeScript, ESLint, **1,788 unit tests across 79 files**, documentation links
  and the isolated production build pass. The build prepares **913 offline
  assets**, including self-hosted PDF.js maps/fonts/decoders. These are build
  checks, not production-browser or offline-installation acceptance.
- The new reader scenario passes in **Chromium, Firefox and WebKit** on isolated
  port **3004**. It covers a generated 12-page PDF with nested contents, selection
  popups (no automatic annotation editor), explicit Add note, private one-click
  highlighting, collapse/filter/current-section navigation, exact search-hit
  movement, private annotation persistence, editable bookmarks, split view,
  appearance, assistant context preparation without transmission, and arranged
  PDF download. The exported PDF is reopened to verify page count/rotation;
  original stored bytes are compared unchanged. Browser page-error lists are empty.
- Fresh selection, outline and warm-reader screenshots are under
  `test-results/pdf-reader-{chromium,firefox,webkit}`. These generated fictional
  fixtures are not published documentation assets. Earlier failed traces remain
  private and are not included as passing evidence.
- Unit checks cover range limits, individual/Unicode text matches, safe links,
  source-preserving page copies and form refusal, appearance v8→v9/down-projection,
  evidence-bound assistant page links, and mocked API authorization/consent/version/
  provider-capability/private-history/quota-retention boundaries.

Real provider/worker OCR and answer quality, two-user annotation synchronization,
password/CJK/rotated-mixed-page fixtures, large-document virtualization budgets,
physical clipboard/assistive-technology use, Quick Preview/canvas integration and
complete offline/revocation rehearsal remain acceptance gates. Richer annotation
tools, collaborative side notes, application-managed page-copy/version saving,
whole-paper assistant batching were not implemented at this checkpoint. Native
annotation import/export and other subsequent work are recorded in the newer
entry above. The implementation is a substantial reader update, not full Zotero
parity or completion of every item in the larger plan.

The Workspace → Files overflow regression is also fixed: its flex rule now targets
the actual Explorer wrapper, with a bounded, independently scrollable file pane
and inspector. The new `workspace-files-scroll.spec.ts` passes in Chromium,
Firefox and WebKit using 44 real staging resources, list/grid modes, a shorter
desktop viewport, repeated wheel input and an open details panel. The final item
and pagination footer remain reachable without moving the workspace tabs.
Screenshots are in `test-results/workspace-files-scroll-{chromium,firefox,webkit}`.

## September 20 unified workspaces and planning

Projects now open as workspaces with Overview, Files, Planning, Discussions,
Reviews and Settings. Planning adds a shared task inspector, recoverable local
Markdown drafts, List/Board/Calendar/Gantt/Workload, calendar-aware schedule
preview/apply/Undo, milestones, routines, evidence links and bounded exports.
Group-wide lifecycle is separate from workspace lifecycle. See the current
[planning contract and explicit limits](WORKSPACE_PLANNING.md).

- **1,776 unit tests across 77 files**, TypeScript, ESLint, theme validation and
  documentation checks pass. The isolated production build succeeds with
  **707 offline assets**. These are build checks, not a new public deployment.
- **18 Chromium workspace/management/review/navigation cases pass** in
  `test-results/unified-workspace-verified-chromium`. This includes server-side
  authorization, retained private-history boundaries, invitation roles, independent
  Trash restoration, schedule preview/apply/Undo, task-draft recovery, legacy links
  and virtualized 5,000-row rendering. Actual 5,000-row database filtering is also
  tested separately; browser virtualization fixtures do not stand in for API tests.
- The two new planning cases also pass in **Firefox and WebKit**. Additional
  Chromium regressions pass for collaborative table edits/peer rebasing/local
  Undo, Explorer selection/drag-and-drop/tabs, account-setting drafts and native
  folder upload/preview focus. A stable opener resolver fixes losing keyboard
  focus after a preview's original file row is replaced by a list refresh.
  Final bar/edge-drag, cancellation and draft/virtualization reruns pass in all
  three browsers under `test-results/unified-workspace-resize-{chromium,firefox,webkit}`.
- Fresh initialization, **18 → 25**, and seeded **24 → 25** upgrade rehearsals
  pass in disposable databases, including idempotency and preserved note/Yjs
  content. Planning API checks cover independent lifecycle, personal/shared
  permissions, dependency cycles, stale previews, atomic apply/Undo, task
  deletion/restoration, evidence and metadata audit. The latest maintained-statistics
  5,000-task read/filter rehearsals take **57–68 ms** on this machine. Earlier
  freshly bulk-loaded fixtures with stale statistics took about ten seconds;
  this is not a production latency guarantee. Keep PostgreSQL autovacuum/analyze
  enabled and verify real workloads.
- At the user's request, local development **8080/1234** was started with the
  new code. Before schema 25, a paired backup was created and its database and
  **14 stored-file checksums** verified. All original values in **13 existing
  content/planning tables** were compared across the migration. No working data
  was reset, reseeded or purged; web/workbench/sync health checks return 200 and
  the worker is running. The backup is under
  `data/before-workspace-planning-20260920` and contains private data.

Browser mutation tests run only on isolated **3004/1236**, never the working
8080 dataset. Initial failures from retired group/project navigation, an obsolete
post-move dialog, and old origin guards were updated and rechecked. A historical
unopened-journal fixture requires its separate named database and was deliberately
not run against the working database. These targeted checks are not a rerun of
every historical suite. Earlier failed reports remain available and are not
counted as green runs.

Personal/default group workspaces remain protected from permanent deletion;
permanent group deletion, critical path/resource leveling, and live co-editing
of task descriptions are not implemented. Full restore rehearsal, real deployment,
physical IME/clipboard and assistive-technology gates remain open, as do the older
large-document and intermittent WebKit navigation issues below. No commit, push
or external deployment was performed for this change.

## September 14 version history, suggestions and save coordination

[Version and review workflows](VERSION_REVIEW.md) now cover in-file comparisons,
named milestones, guarded restore/copy/export, separate Markdown/math proposals,
atomic decisions/Undo, assigned reviews, previous-visit baselines and shared image
working drafts. Existing crop/avatar work and the current editor remain intact.

- **1,762 unit tests across 76 files**, TypeScript, ESLint, theme validation,
  documentation checks and the isolated production build pass. The build prepares
  **703 offline assets**. Diff/projection tests include exact repeated-text anchors,
  Unicode, overlapping peers, unchanged accepted source, bounded large-change
  fallback, single-flight acknowledgement and durable-write microtask ordering.
- The **built production candidate passes 44 of 45 review browser cases**:
  15 Chromium, 15 Firefox and 14 WebKit. This includes a deliberately closed
  editing socket and failed sync-token retries: **Mark reviewed** still records
  the already-durable compared revision over HTTP with exact hash/settings and
  permission checks. It does not need to force a document save. The remaining
  WebKit failure is a reload-time sync-token access-control console diagnostic;
  all permission, overlap and idempotent-decision assertions in that scenario
  passed. It is not a fully green browser gate. Evidence:
  `test-results/revision-production-verified-{chromium,firefox,webkit}`.
- The final development-server review run passes **15 Chromium**, **15 Firefox**
  and **14 of 15 WebKit** cases. Coverage includes arbitrary revision pairs,
  rendered/source/unified comparisons, atomic tables/equations in light/dark,
  metadata version conflicts, safe text/math/image restore, proposed insertions,
  author/editor permissions, replies/decisions, bulk overlap rejection,
  idempotent retry, two-tab draft ownership, sign-out and offline proposal recovery.
  All assertions in the WebKit dark comparison scenario passed except its final
  no-console-errors check: a full-page reload intermittently reports access-control
  diagnostics for reads from the outgoing page. This is **not a green suite** and
  the broader WebKit navigation gate remains open. Evidence:
  `test-results/revision-final-{chromium,firefox,webkit}`.
- **Nine current-editor/collaboration regressions pass** after the final code
  changes: heading/source fidelity, ten-client convergence and local Undo,
  offline rich/source peers, membership revocation, snapshot generation/Trash,
  local-storage failure, contextual math/table controls, pinned status, discussion
  anchors and quoted equations with offline export. Evidence:
  `test-results/revision-final-editor-regression`.
- **27 image-engine browser cases pass**, nine per browser, including cached
  unchanged PNGs, pixel invalidation, Undo/reopening, crop/resize, masks/groups,
  editable text, filters, PSD and allocation failures. Firefox can encode an
  untouched transparent canvas differently from restored transparent pixels;
  the test now decodes the saved PNG and checks actual pixels, not encoding identity.
  Evidence: `test-results/revision-image-engine-final-verified`.
- Fresh initialization, **18 → 24 upgrade** and idempotent migration rehearsals
  pass. The actual draft-maintenance SQL passes a rollback-only staging rehearsal:
  both recovery heads survive even when old/new assets share a path, both previews
  and recent uploads survive, and expired orphans enqueue reference-safe cleanup.
  Reversible decisions retain attachment versions independently of live indexing
  and release those references on Undo. Reproduce with
  `npx tsx scripts/verify/verify-revision-storage.ts` after isolated image fixtures.
- Isolated synchronization fault injection passes: acknowledged edits survive
  SIGKILL, denied database writes return a save error rather than success, binary
  journals recover, and graceful shutdown drains pending writes. This is not a
  full database/file backup-restore or Docker deployment rehearsal; neither was
  repeated for this change.
- Five repeated Chromium accept/Undo/reaccept cases and five Firefox math
  restore/suggest cases pass after hardening stale-card and reconnect transitions.
  Background list refresh no longer temporarily disables a button between pointer
  down/up; only an outstanding action or required newer proposal version blocks it.
  Earlier failed harness reports are retained, not counted as passing evidence.

An earlier production run exposed the unnecessary editing-connection dependency
in Mark reviewed; the final candidate above removes it and adds explicit connection-
interruption coverage. A previous WebKit production run passed all 15 cases, but
the subsequent console diagnostic means the intermittent navigation issue must
not be declared resolved merely by retrying until a run passes.

### Performance limit still open

The opt-in same-machine editor benchmark **does not pass its full gate**.
With 100,000 characters, the current Axiom rich surface measured input-to-frame
p95 **38.6 / 37.3 / 37.7 ms** at top/middle/end (50 edits at each position).
At 980,000 characters, top-of-document p95 was **2,685.2 ms**, above the 200 ms
target; the run timed out at five minutes before completing the remaining rich
locations. Evidence is `test-results/revision-editor-performance`. Near-million-
character rich editing needs further projection/rendering work; this release
must not be described as large-document performance-ready.

A separate ten-sample Node smoke measurement of the new source diff, for one
localized edit, recorded p95 **2.4 ms at 100k** and **13.4 ms at 980k** characters.
This measures the diff algorithm only, not editing, worker transfer or painting.
Comparison rendering and storage queues are bounded; that does not remove the
existing rich-surface workload limit.

### Local service and deployment boundary

Only isolated staging on **3004/1236** was used for browser mutations and fault
injection. Local development on **8080/1234** was forward-migrated to schema **24**,
with original row values in **18 content, identity and file tables checked unchanged**.
No working data was reset, reseeded or purged; web and sync health checks pass.
No commit, push, public deployment or provider configuration was performed.

Physical IME/clipboard, real Safari devices, assistive technology, real large
research workloads and a matched database/file restore rehearsal remain deployment
acceptance gates. Image draft assets are included in the backup inventory, but
that implementation change alone is not a completed restore rehearsal.

## September 14 crop, resize and profile pictures

- Image Studio now has a shared crop/resize preview with pointer and keyboard
  selection, aspect ratios, current dimensions, linked proportions, resampling,
  cancellation and preflight size limits. Geometry changes are atomic and
  undoable, use document coordinates, and retain groups and masks. The dialog
  warns when transformed or nonuniformly resized text must become pixels.
- Profile photo selection uses the same crop surface with a fixed square and a
  round avatar preview. Only the selected area is uploaded, sampled from the
  original image into 256 × 256 px; large inputs have a bounded working preview.
  EXIF orientation, metadata removal, cancellation, retries, unsaved profile
  drafts and existing profile-version conflict checks are retained.
- **18 UI scenarios pass**, six each in Chromium, Firefox and WebKit. Coverage
  includes crop handles/arrows/presets, cancel, undo/redo, save/reopen, invalid
  dimensions, resampling, context menus/shortcuts, avatar output pixels,
  orientation, metadata, upload retry, stale versions and account-toolbar refresh.
  Light/dark previews and the avatar dialog have current screenshots; assertions
  check the actual image surface fits beside the controls. Evidence is in
  `test-results/image-crop-final-{chromium,firefox,webkit}`.
- **24 image-engine browser cases pass**, eight per browser, covering document-
  space crop/resize, rotated/grouped/masked layers, editable-text recovery,
  bundle reopening, unchanged state after failed allocation and existing pixel,
  selection, filter and PSD behavior. Evidence is in
  `test-results/image-geometry-engine-current`.
- Five existing Chromium image-import/recovery/authorization cases and the
  existing profile draft/cancel/save/failure case pass again on this build.
  Outputs are `test-results/image-copy-geometry-final-chromium` and
  `test-results/avatar-profile-regression-final`.
- **1,721 unit tests across 70 files**, TypeScript, ESLint, documentation checks
  and the isolated production build pass (**687 offline assets**). Browser
  mutation tests use only isolated staging on **3004/1236**. The existing
  port-8080 development service and working data are preserved. These changes
  have not been committed, pushed or deployed to production; physical-device
  Safari and assistive-technology acceptance remain outside these checks.

## September 14 image editing and recovery regression

- Reproduced **Edit a copy** opening a transparent 1200 × 800 starter instead of
  the selected 320 × 200 image. New projects already have an immutable blank
  version, which previously bypassed the import. The loader now imports only into
  the untouched initial template; saved versions and local drafts take priority.
- Fixed the Markdown image viewer's edit action reaching a PDF-only metadata
  check, and Save copy using an obsolete empty-version expectation. Metadata
  remains permission-checked; paper annotations still reject non-PDF files.
- WebKit rejected Blob objects during local recovery writes. Drafts now store
  binary bytes and accept earlier Blob records when reading; leaving still waits
  for the IndexedDB transaction to commit.
- **15 browser scenarios pass**, five each in Chromium, Firefox and WebKit:
  visible imported pixels, cloud save/reload, a pinned older image opened from a
  Markdown note, Save copy followed by another save, recovery without re-fetching
  the source, intentionally saved blank canvases, and metadata authorization.
  Tests verify unchanged original image bytes/versions and Markdown. Fresh
  evidence is under `test-results/image-edit-copy-current-{chromium,firefox,webkit}`.
- **1,700 unit tests across 69 files**, TypeScript, ESLint and the isolated
  production build pass (**685 offline assets**). Two existing Chromium viewer
  regressions also pass: deletion access checks and source-safe image interaction
  with keyboard access and dark-theme geometry.
- Tests use only isolated staging on **3004/1236**. The existing port-8080
  development service and working dataset are preserved; its direct local health
  check returns 200. This fix has not been deployed or pushed.

## September 13–14 documentation and identity release review

This review preserves the working development dataset and port-8080 service.
Mutation tests and fictional showcase capture use a separate local PostgreSQL
database, attachment store and production-build profile on ports **3004/1236**.
The local checks use Node **22.17.0** and npm **11.18.0**; Node 24 remains the
recommended runtime and Docker image target. No public deployment or push was run.

- **1,685 unit tests across 68 files pass**, including shared SVG geometry,
  maskable-icon pixel bounds and 12 documentation-link parser cases.
- TypeScript, ESLint, both theme-pack validators, formatting/diff checks and the
  isolated production build pass. The final build prepares **685 offline assets**.
  Documentation checks cover 42 Markdown guides plus local HTML image/picture
  references and npm script paths; external URLs and fragment anchors are not checked.
- **57 product browser scenarios pass** during the pre-branding review: 30
  file-first/reading-mark/settings/viewer scenarios, five editor-vNext scenarios,
  nine management/productivity API scenarios and all 13 Canvas-platform scenarios.
  This includes collaboration/offline convergence, discussions, create/join group
  flows, workspace lifecycle, Trash, native-file creation and Canvas interactions.
- **Nine branding scenarios pass** on the final candidate, three each in Chromium,
  Firefox and WebKit: auth/workspace identity, light/dark geometry, named controls,
  focus, forced colors, unchanged source, versioned favicon/PNG routes, Apple icon,
  manifest shortcuts and the public social-image asset. The five editor-vNext
  scenarios also pass again after the visual rollout. These reruns are not added
  to the product total a second time.
- Fresh initialization and **18 → 20 upgrade rehearsals pass**, including an
  idempotent migration rerun, retained note/Yjs state and legacy discussion data.
  `scripts/verify/rehearse-current-migrations.ts` creates two new named test
  databases and retains them for inspection; it never migrates the configured
  application database. This is not a full backup/restore or Docker rehearsal.
- Real light/dark editor and Canvas views were captured from fictional content.
  The 1600 × 900 banners, 1200 × 630 social preview and original SVG/PNG logo were
  visually inspected. Assets, source composition and reproducible capture commands
  are in [Showcase](SHOWCASE.md) and [Branding](BRANDING.md).

Private evidence directories are `test-results/release-docs-product-baseline`,
`release-docs-editor-baseline`, `release-docs-management-verified`,
`release-docs-canvas-verified` and `release-docs-final-{chromium,firefox,webkit}`,
all under `test-results/`.
The first product invocation omitted the editor suite's explicit vNext environment
flag, so its preflight failed and four cases were skipped; the separate five-case
rerun passes. Stale management/Canvas test navigation was updated to the current
shared creation dialog and persistent sidebar, then rerun successfully. Earlier
failed harness reports remain retained and are not counted as passing suites.

The cross-browser branding checks do **not** clear the older WebKit navigation
access-control diagnostic below. Physical IME/clipboard, Safari device behavior,
assistive technology, printing, large real workloads and configured external
providers still require target-environment acceptance. The September 11 Docker
rehearsal below is historical, not repeated by this documentation release.

## September 13 note-link icon alignment

- Note icons share the label's font box instead of using a fixed top offset.
  They remain attached to the first line of wrapped aliases; bounded icon ink
  prevents WebKit from painting bars above/below its inline mask.
- **12 production browser scenarios pass** (four each in Chromium, Firefox and
  WebKit), including measured Write/Read alignment for Source Sans 3, Source Serif
  4 and Latin Modern at 14/18/30 px and line heights 1.3/1.75/2.4. Existing theme,
  navigation, source-safety, focus, forced-color and print checks also pass.
  Fresh screenshots are under `test-results/note-link-alignment-production-chromium`,
  `test-results/note-link-alignment-production-firefox` and
  `test-results/note-link-alignment-production-webkit`.
- **742 targeted Markdown/projection unit tests**, TypeScript, ESLint and the
  isolated production build pass. The existing development service on port 8080
  serves the corrected CSS; no editor-source or dependency change was needed.

## September 13 note-link appearance

- Internal `[[note links]]` now share a decorative note icon, accent tint and
  underline in Write/Read. Unresolved links use a dashed underline and an escaped
  descriptive title. Long labels wrap, zero radius remains square, keyboard focus
  stays visible without a doubled ring, and print omits decoration.
- **Nine production browser scenarios pass** (three each in Chromium, Firefox
  and WebKit), covering light/dark appearance, typography, wrapping, hover,
  keyboard/modifier navigation, continued editing, forced colors, reduced motion
  and print. Fresh screenshots are in `test-results/note-link-styles-verified-chromium`,
  `test-results/note-link-styles-verified-firefox` and
  `test-results/note-link-styles-verified-webkit`.
- **1,670 unit tests in 66 files**, TypeScript, ESLint, formatting/documentation
  checks and the isolated production build pass (681 offline assets). No
  dependency, migration or source-format change is required; port 8080 is retained.

## September 13 minimap marker alignment correction

- Cursor/search markers now use measured text-row positions and the same scale
  and scroll offset as the miniature. Single markers no longer snap to arbitrary
  eight-pixel coordinates; offscreen Proportional-mode markers are clipped with
  their content. Position measurements are cached independently of scrolling,
  and folded blocks stay folded.
- **19 Chromium production minimap checks pass**, including seven new alignment
  scenarios and both large-document benchmarks. The seven new scenarios also
  pass in **Firefox and WebKit**. Coverage measures actual caret/search geometry
  in Write/Source with Fit/Fill/Proportional sizing, horizontal movement, wrapped
  lines, scrolling, typing, resizing, embedded code/math and folded code.
- **Four existing Chromium regressions pass** for rich/source offline
  convergence, source-anchored discussions, bookmark operations and nested
  reading-mark targets. **1,668 unit tests in 66 files**, TypeScript, ESLint,
  formatting checks and the isolated production build pass (681 offline assets).
- Fresh screenshots and benchmark evidence are under
  `test-results/minimap-marker-production-chromium`,
  `test-results/minimap-marker-production-firefox`,
  `test-results/minimap-marker-production-webkit` and
  `test-results/minimap-marker-production-regression`. Synthetic median input
  timings are **7.7 → 23.0 ms** (10k source lines) and **10.9 → 12.0 ms** (50k);
  both satisfy the existing bounded-overhead check. These are automated desktop
  checks, not physical IME/clipboard certification. No migration or reset was
  required, and the user's existing development service on port 8080 is retained.

## September 13 viewer fullscreen correction

- The fullscreen button previously targeted the native dialog, which is an
  [incompatible fullscreen element](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen#compatible_elements).
  It now targets an inner shell containing the title, close action and viewer
  controls. Only this viewer's fullscreen session is tracked and cleaned up.
- Unsupported or denied native requests expand the viewer to the browser window.
  Escape restores the normal view before closing it; the close action also exits
  fullscreen. Existing source content and annotation state are retained.
- **15 Chromium production scenarios pass** (14 viewer workflows plus sharing
  dialog regression), together with **four Firefox and four WebKit fullscreen
  scenarios**. Tests exercise images/Mermaid, valid native targets when available,
  viewport geometry, visible controls, zoom, exit/re-entry, Escape, close cleanup,
  and explicitly unavailable/rejected fullscreen APIs. Earlier viewer totals did
  not exercise this button and are not evidence of the previous implementation.
- **1,663 unit tests**, TypeScript, ESLint and the production build pass (681
  offline assets). Fresh images/traces are in
  `test-results/visual-fullscreen-production-chromium`,
  `test-results/visual-fullscreen-production-firefox` and
  `test-results/visual-fullscreen-production-webkit`. These are automated desktop
  checks, not OS-level shortcut certification. No migration or reset was needed;
  the existing development service on port 8080 is preserved.

## September 13 image and Mermaid viewer

- **1,663 unit tests in 66 files**, TypeScript, ESLint, both theme packs and the
  isolated production build pass (681 offline build assets). Documentation checks
  resolve 171 local references across 40 documents; `git diff --check` passes.
- **10 Chromium, 10 Firefox and 10 WebKit viewer workflows pass** against the
  current production candidate. Coverage includes Write/Read image and Mermaid
  opening, source-safe context menus, Alt+Enter, cursor return, intrinsic zoom,
  initially linked/relinked comparison and Fit, metadata decoding, PNG/SVG export,
  vector markup, placement isolation, private/shared ACLs, reply ownership,
  moderation, optimistic conflicts, offline editing and replay after closing,
  rich annotation bodies, undo/redo, canvas card identity, stored images and
  access revalidation after trashing a file.
- **16 existing Chromium regressions pass**, covering collaboration/offline
  convergence, source-backed discussions, stable equations, quoted equations and
  export, bookmarks/annotation cards, permissions, conflicts, floating-card
  appearance and sharing-dialog keys. Evidence is under
  `test-results/visual-viewer-regression-verified`.
- These checks caught and fixed duplicate rich-editor keys, an initial no-op
  annotation write that could interfere with sharing, privacy changes hidden by
  a stale local revision, atom-focus keyboard navigation, unlinked initial
  comparison transforms, and page-unload read lifetimes. Read cancellation is
  separately tested not to interrupt writes or block a canceled navigation.
- Fresh screenshots/traces are under `test-results/visual-viewer-chromium-verified`,
  `test-results/visual-viewer-firefox-verified` and
  `test-results/visual-viewer-webkit-verified`. Light/dark views, comparison,
  Mermaid export and annotation inspectors were visually reviewed; square corners,
  disabled shadows, horizontal containment and the fixed footer are checked.
- Additive migration **20** is applied to staging and local development without a
  data reset. The existing port-8080 development service remains running. This is
  not a public deployment, mobile redesign, physical clipboard/IME or
  assistive-technology certification. The older WebKit permission-change
  `sync-token` diagnostic below is not superseded by these viewer-only checks.

See [the viewer contract](VISUAL_VIEWER.md) for controls, metadata privacy,
non-destructive exports, annotation recovery and implementation limits.

## September 13 document minimap

- **1,635 unit tests in 65 files**, TypeScript, ESLint, both theme packs and the
  isolated production build pass (675 offline build assets). The minimap adds no
  editor dependency or SQL migration; appearance preferences advance to schema 8.
- **12 Chromium minimap checks pass**, plus a final targeted invalid-width
  recovery rerun. **10 Firefox and 10 WebKit minimap workflows pass**. Coverage
  includes opt-in behavior, Write/Source/Read, live settings preview/cancel/reset,
  account persistence and offline recovery, schema-7 stale-writer protection,
  click/drag/wheel/keyboard navigation, rapid End/Enter, mapped-selection focus
  restoration, live equation editors, folds, side changes, compact panes, print
  exclusion, tab cleanup, search/presence and private/shared annotation markers.
- **17 existing Chromium editor/reading-mark/Appearance regressions pass**,
  including actual two-client/offline convergence, anchored discussions, quoted
  equations and export, bookmark/annotation operations, permissions, privacy,
  conflict handling, folding and fixed-footer geometry.
- Source benchmarks use 10,000 and 50,000 short ASCII payload lines, a 1440×1000
  desktop viewport, and synthetic `beforeinput` → next-animation-frame timings.
  Recorded median baseline → enabled times are **10.0 → 21.7 ms** (10k) and
  **10.8 → 10.6 ms** (50k). Both meet the test's bounded-overhead threshold;
  lower timings in one run are noise, not evidence of a speedup. Both use a
  **120×814** canvas. Fit-map scrolling does not repaint the bitmap; geometry
  measurement checks pass. This is not a universal latency guarantee for every
  Markdown structure, machine, input method or document size.
- Fresh screenshots and JSON benchmark reports are under
  `test-results/minimap-desktop-final`. Final width recovery is under
  `test-results/minimap-width-recovery-final`; cross-browser evidence is under
  `test-results/minimap-firefox-final` and `test-results/minimap-webkit-final`.
  Existing-editor evidence is under `test-results/minimap-regression-final`.
  Light/dark views and the settings scratchpad were visually reviewed, including
  square corners, no shadows and a compact desktop pane.
- These are isolated desktop checks, not a new deployment, mobile redesign,
  physical IME/clipboard or assistive-technology certification. The earlier
  WebKit permission-change diagnostic below is not closed by the minimap suite.
  The normal development service on port 8080 is preserved.

See [the minimap contract](MINIMAP.md) for controls, privacy, density limits,
rendering architecture and theme-authoring boundaries.

## September 13 reading marks and annotation cards

- **1,621 unit tests in 64 files**, TypeScript, ESLint, both theme packs and the
  isolated production build pass (672 offline build assets). Documentation checks
  resolve 156 local references across 38 documents; `git diff --check` passes.
- **18 Chromium checks pass**: 17 editor/reading-mark/Appearance scenarios and one
  MCP authorization workflow. Coverage includes bookmark edit/delete/Undo, robust
  anchors and reattachment, nested/folded targets, private drafts, tab switching,
  read-only private authoring, sharing/replies/tombstones, offline edits/deletion
  before first acknowledgement, conflict recovery without accidental publication,
  route-variant privacy and MCP private-thread isolation. Existing shared editing,
  source-anchored discussions and dark/enlarged layout checks remain green.
- **Nine Firefox reading-mark workflows pass. Eight of nine WebKit workflows
  pass.** WebKit completes the read-only/private-sharing assertions but fails the
  accumulated page-error assertion on a `sync-token` access-control diagnostic
  during the permission-change reload. Editor-lifecycle request cancellation did
  not eliminate it; it remains a browser release gate, not passing acceptance.
- Fresh screenshots and traces are in `test-results/reading-marks-production-final`,
  `test-results/reading-marks-firefox-final`, `test-results/reading-marks-webkit-final`
  and `test-results/reading-marks-mcp-final`. Dark floating cards were visually
  reviewed with square corners and shadows disabled, including math/code bodies,
  visible actions and viewport containment.
- Additive migration **19** was applied to the isolated staging database and the
  local development database without resetting data. The existing development
  service on port 8080 remains running. This is scoped desktop verification, not
  a new public deployment or physical IME/assistive-technology certification.

See [the reading marks contract](READING_MARKS.md) for usage, privacy, recovery
limits and migration instructions.

## September 13 folding-gutter follow-up

- **1,610 unit tests in 63 files**, TypeScript, ESLint, theme validation and the
  isolated production build pass. Folding adds no Monaco runtime dependency.
- **400 Chromium editor-lab checks pass**, with the opt-in benchmark skipped,
  plus **76 focused Firefox/WebKit checks**. A **54-case three-engine focused
  rerun** passes after final control-order/geometry and caret-boundary fixes.
  This covers collapsed projection
  mapping, nested/footnote folds, local history and source invariance, peer edits,
  navigation, permissions, hover/keyboard focus and print lifecycle restoration.
  Folding the only/last block and backward range replacement are checked without
  invalid text-selection warnings.
- **Three full-app Chromium checks pass** for guide preferences, light/dark/large
  metadata geometry and real two-client editing while one client's code stays
  folded. Fresh screenshots: `test-results/editor-folding-current`; editor runs:
  `data/editor-folding-chromium-final`, `data/editor-folding-cross-browser`, and
  `data/editor-folding-caret`. This is not physical IME/printing certification.

## September 13 block-editing follow-up

- **1,599 unit tests in 62 files**, TypeScript, ESLint, both theme packs, documentation
  links and the isolated production build pass (669 offline build assets).
- **382 Chromium editor-lab checks pass**, with the opt-in benchmark skipped.
  **158 focused Firefox/WebKit checks pass**, with two Chromium-only CDP composition
  cases skipped. Coverage includes list triggers/nesting, empty-block Backspace,
  parent-aware separators, peer edits, undo, permissions, LF/CRLF, metadata and
  view-only range guides. Screenshots are in `data/editor-lab-results` and
  `data/editor-lab-boundaries-cross-browser`.
- **10 full-app Chromium checks pass** against an isolated production server on
  port 3004: guide preference preview/cancel/reset/reload, stale schema protection,
  metadata light/dark/large-type geometry, retained Settings drafts, offline
  preference convergence and interface layout. Evidence is in
  `test-results/block-editing-acceptance`. The narrow/mobile scenario was excluded;
  no new mobile acceptance is claimed.
- These are scoped editor/settings checks, not a fresh deployment rehearsal or
  physical-input certification. See [the editor contract](EDITOR_VNEXT.md) and the
  remaining target-device gates below. Development data was not reset for testing.

## September 11 release preparation (earlier evidence)

- Generated cleanup safeguards pass unit tests. The reviewed cleanup removed 94
  obsolete builds/cache targets (28.62 GiB logical bytes); current services, private
  data, backups and all test evidence were retained.
- Vitest is pinned to 4.1.11. The dependency audit after the update reports no known
  vulnerabilities; this is not a security certification.
- Development and production defaults now select the same current Axiom editor.
  The dependency boundary and explicit legacy rollback are documented in
  [editor architecture](EDITOR_VNEXT.md).
- TypeScript, ESLint, all **1,529 tests in 56 files**, both reviewed theme packs and
  the local documentation/npm-script link checks pass. A production build with 643
  offline assets succeeds. Build workers now exclude database/provider credentials
  and disable eager OAuth registration during compilation.
- Fresh isolated browser checks pass **23 Chromium** scenarios covering Canvas,
  Explorer, collaboration, MCP, offline/recovery and themes, plus **6 Firefox** Canvas
  scenarios. Screenshots/traces are in `test-results/beta-release-current` and
  `test-results/beta-release-firefox`, with corresponding HTML reports.
- The fresh **WebKit run passes 5 of 6**, then fails the accumulated page-error check
  on the same navigation access-control diagnostic. The failure is retained in
  `test-results/beta-release-webkit`; it is not counted as passing acceptance.
- The fresh isolated Docker Compose rehearsal passes on Docker Desktop: Node 24,
  PostgreSQL 16 and Caddy HTTPS; first owner and invitation/join; two-browser editing;
  upload/checksum/preview; Canvas; Trash restore/purge; background export; restart
  persistence; and backup verification/restoration into a separate database and
  storage volume. Restored canonical note/Canvas content and every stored blob
  checksum match. The private receipt is
  `data/deployment-rehearsal-sxggrC/receipt.json`; fresh browser evidence is under
  `test-results/deployment-current/workflow` and `test-results/deployment-current/restart`.
  Earlier failed harness attempts remain alongside them and are not passing evidence.
  This is a local container rehearsal, not acceptance on a public Linux host.

## Reproduce checks

```sh
npm run typecheck
npm run lint
npm test
npm run validate:themes
npm run docs:check
AXIOM_DIST_DIR=.next/release-candidate npm run build
```

The isolated local staging helper supports `init`, `migrate`, `admin`, `build`, `web`,
`sync` and `worker`. Its default database is `axiom_release_test`, web port 3004, sync
1236 and private storage `data/release-test-attachments`; use separate terminals for
long-running services. It refuses the configured live database and remote PostgreSQL.
Production rehearsal uses fresh, separately named Compose resources, never `.local-db`.
Run `npm run test:deployment` with Docker available and localhost ports 8181/8443 free;
see [the isolation and cleanup contract](DEPLOYMENT.md#isolated-deployment-rehearsal).

Existing browser suites may enforce a specific isolated origin. The historical
root staging wrappers preserve those profiles, but new work should use the shared
runner. Test owner credentials can be supplied with `TEST_OWNER_EMAIL` and
`TEST_OWNER_PASSWORD`; do not seed the main instance to satisfy older tests.

For the current editor and branding checks, with isolated staging already running:

```sh
TEST_APP_URL=http://localhost:3004 NEXT_PUBLIC_AXIOM_EDITOR_ENGINE=milkdown \
  npx playwright test tests/e2e/editor-vnext.spec.ts tests/e2e/branding.spec.ts
# Repeat branding with TEST_BROWSER=firefox and TEST_BROWSER=webkit.
npx tsx scripts/verify/rehearse-current-migrations.ts
```

The migration rehearsal needs a local PostgreSQL role with database-creation
permission. Its new databases are deliberately retained, not silently dropped.
For artwork generation, use the separate [showcase workflow](SHOWCASE.md).

## Required operator acceptance

- Fresh migration, first owner, invitation/join and permission boundaries.
- Two-browser editing, acknowledged persistence, restart and offline recovery.
- Upload/checksum/download/preview, completed background export, Trash restore and
  protected permanent deletion, workspace/group administration, Canvas persistence.
- Backup verification and restoration into a different database and storage root.
- HTTPS origin/cookies/WebSockets, no public internal APIs, no development secrets or
  data in images, persistent volumes, least-privilege database account.

## Still not certified

Physical OS IME and cross-application clipboard, physical Safari, assistive technology,
native printing and dense mixed-research workload performance need target-device
acceptance. Real SMTP, S3, institutional OIDC, OCR/AI and Office-provider behavior need
their configured environment. Multi-host sync, a Canvas portable-ZIP importer and
arbitrary user CSS are not delivered by this release preparation.

The earlier Canvas WebKit run had an intermittent navigation access-control diagnostic;
the traced repeat passed. The original failure and repeat traces remain private under
`test-results/canvas-release-webkit` and `test-results/canvas-webkit-diagnostic`.
Its root cause is not proven, and cleanup does not relabel it fixed. Complete Typora
parity and unrestricted production readiness are not claimed.
