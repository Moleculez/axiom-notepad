# Research tools

Desktop studios are file views. Open a math, image, text or canvas resource from
Explorer, or create one through **New** alongside Markdown notes. Canonical routes
are `/workbench/math/:id`, `/image/:id`, `/text/:id` and `/canvas/:id` under the
same workbench prefix. Legacy Tools links redirect; the Tools landing and separate
creation page are removed. See [file navigation](FILE_WORKBENCH.md). These are
integrated research tools, not a claim of complete LaTeXLive, Photoshop, Office or
Typora parity.

## Available now

- A shared catalog of 177 locally rendered math-symbol SVGs in both note-editor
  completion menus and Math Studio. Existing insertion text, placeholder navigation,
  code-language logos, menu icons and section dividers are retained. Code-body
  snippet completion stays disabled.
- Resource-backed Math and Image Studio projects in the existing application tabs,
  Explorer, workspace permissions, quotas, Trash and database/attachment backups.
  Math resources declare LaTeX source explicitly so the normal note pane does not
  accidentally interpret them as Markdown. Explorer copies retain tool settings,
  LaTeX source and immutable file previews, but do not inherit edit leases,
  discussions or AI jobs. Restoring a file version also retains its previews;
  copies, cross-space moves and restores account for preview storage in quotas.
- Math Studio: collaborative LaTeX source and MathLive visual input over the same
  Y.Text, author-only undo, collaborator presence, named checkpoints, symbol
  search/favorites, research templates, macros, side-by-side/stacked previews,
  equation numbering, foreground/paper colors, font size and export resolution.
  Switching modes is not an authored edit. A peer update during visual editing
  retains the visual draft and refuses to overwrite the shared equation.
- Math history now compares source and rendering settings, names milestones and
  safely restores both. Checkpoints include pending settings with a version check.
  Math suggestions use a separate visual/source projection; accepted equations
  change only after an editor decides. See [version and review workflows](VERSION_REVIEW.md).
- Source-mode LaTeX autocomplete: type `\` or a command prefix, or request
  suggestions with Ctrl+Space. Use arrows to choose, Enter/Tab to insert, Escape
  to dismiss, and Tab/Shift+Tab to navigate template arguments. Suggestions
  include paired `\begin{...}` environments and configured project macros;
  comments and escaped backslashes do not trigger them. Insertions are individual
  author-local undo steps and recheck the current source after peer edits.
- The Math library has grouped symbol previews, searchable categories, explicit
  saved-symbol stars, command details, keyboard-accessible tabs and ten rendered
  research templates. Search also matches template topics/descriptions; saved
  searches stay within saved symbols. Palette insertion returns focus to the
  source caret, with editable argument ranges for structural symbols.
- Equation inspector → **Open in Math Studio** → **Review in note**. Returning is
  explicit: encoded CRDT positions plus exact original block text and generation
  protect the source. Unrelated peer changes can rebase; changed/deleted equations
  are rejected. Quote/footnote prefixes and original line endings are retained.
  This return link is account-scoped to the current browser tab; the equation
  project itself is persistent and collaborative.
- Math exports: SVG, PNG, JPEG, LaTeX, MathML, HTML, OMML and DOCX. DOCX contains an
  editable Office equation for the supported MathML subset plus the LaTeX source.
  Unsupported Office constructs produce an explicit error, not a fake editable
  bitmap. Office application's visual acceptance remains a release gate.
- Live preview has a compact SVG/PNG/JPG format selector with direct Copy and
  Download actions, 1×–6× raster resolution and SVG/PNG transparency. JPG always
  uses the selected paper color. The icon-based More menu separates LaTeX/MathML
  copying from full exports and rendering settings. Copied LaTeX includes project
  macros; image actions capture one matching render before asynchronous encoding
  and reject empty, pending or stale previews. No source edits or uploads occur.
  Browsers without native SVG clipboard support copy SVG markup; unsupported JPG
  copying uses an explicitly labeled opaque PNG. Downloads retain actual SVG,
  PNG or JPG bytes. Denied/unavailable clipboard access offers download guidance.
- Image Studio: an Axiom-owned layered canvas engine with brush/eraser, raster
  shapes/arrows, editable text with three bundled font families, move/pan/zoom,
  rectangular/elliptical/lasso selections, feather/invert/crop, layer masks,
  opacity/blending, one-level groups, ordering, clone and sampled-healing brushes,
  rotation/flips, resize, merge, and worker-based image adjustments. Pixel-history
  entries store affected regions. PNG/JPEG/WebP, editable `.axiom-image` bundles
  and common 8-bit RGB PSD interchange are available.
- **Crop** opens a preview with draggable corners, move/draw selection, exact
  coordinates, aspect-ratio presets and keyboard adjustment. A rectangular
  selection seeds the crop; Cancel does not change the project. **Resize** opens
  with the current dimensions, linked proportions, 25/50/100/200% presets and
  smooth or nearest-neighbor resampling. Both appear in the toolbar and artboard
  context menu; shortcuts are **C** and **Ctrl/Cmd+Alt+I**. Apply affects all layers
  in document coordinates, retains groups/masks, and supports Undo/Redo and saved
  version reopening. Invalid sizes fail before modifying any layer.
- Image projects use a 90-second edit lease with fenced saves, an expected source
  version, idempotent commits, immutable version history and saved-version
  discussions. Heartbeats extend the lease; a conflicting session is read-only.
  Local IndexedDB recovery is account-scoped. Leaving with unpublished work offers
  a durable local draft first; full page exits also release the lease. Older cloud
  versions and original imported images are never overwritten.
- Shared image working drafts now autosave cached layer assets after 3 seconds
  idle / 15 seconds maximum. Metadata-only edits reuse PNGs; both the current and
  preceding cloud heads are recoverable and included in quotas/backups. **Save
  version** creates an immutable milestone. History includes split/wipe comparisons,
  copies/exports and guarded restore with a **Before restore** milestone; generic
  Explorer restore refuses to bypass an active draft. This is exclusive leased
  image editing, not simultaneous multi-user painting.
- **Edit a copy** imports the displayed immutable image version into the new
  project's untouched starter canvas. Saved edits and recoverable local drafts
  take precedence over import URL parameters on reopening. Imports can autosave as
  shared working drafts but stay unpublished until Save version; Save copy uses the new project's version fence.
  Local recovery stores binary bytes for WebKit compatibility and still reads
  existing Blob drafts. Attachment metadata supports images without relaxing
  file permissions or the PDF-only paper-annotation contract.
- One file-preview surface for Explorer quick previews and full file tabs.
  Native audio/video playback has speed, loop, local WebVTT
  captions and timestamp links; images have zoom/pan and Edit a copy. Text has
  encoding detection/selection, search, wrapping and bounded incremental loading.
  CSV/TSV and XLSX use virtualized data grids with cell addresses. XLSX adds
  basic saved formatting, merged cells, frozen panes, resizable columns, row
  filtering and numeric/text sorting. Cell addresses remain original worksheet
  addresses after sorting; cell links are pinned to the immutable file version.
  Shift/arrows or dragging selects a range for TSV copying and count/sum/average.
  The formula bar inspects formulas and their cached results; nothing is calculated.
  Parsing runs in a worker. Macros, embedded objects and external links never run.
  Sorting is disabled for merged sheets; filtering shows their underlying cells.
  Hidden sheets/rows/columns are included, with labels/warnings. Charts, conditional
  formatting, exact Excel number formats and full theme/pivot fidelity are not supported.
  The original full PDF reader/annotations stay intact.
- Modern DOCX/PPTX detection and queued private PDF conversion, with immutable
  derivative caching and original-file download fallback. A worker-based **Reading**
  view works without conversion: Word headings, text, tables, original comment
  labels and footnotes; PowerPoint slide order, hidden-slide labels and speaker notes.
  The navigator searches extracted body/slide text and slide notes; Word comment and
  footnote panels are separate. Reading links are version-pinned; text copying and
  text-file export are explicit. **Pages/Slides** uses the optional private PDF
  converter, with fit/zoom and page navigation. Text view is deliberately not a
  visual reproduction: images, charts, equations, numbering and exact layout require
  conversion or the original application. Original comment identities/threads are
  not imported into workspace accounts. Legacy Office formats remain download-only.
  Workspace file discussions can also carry version/timestamp/page/line/cell/region
  metadata; those discussion anchors are not automatically jump links.
- Group administration → **Providers**: encrypted credentials, private compatible
  API origins allowlisted by the server, OpenRouter, capability controls, explicit
  connection tests and daily UTC request quotas. Math assistance supports
  generate/check/explain and image OCR with paste/upload/crop or a selected local
  PDF page. Every submission requires current consent, shows the destination and
  source, and returns a result for review/copy/explicit insertion. No automatic
  submission or retries. Crashed/indeterminate external jobs are marked uncertain.

## Safety and limits

- Images: 8,192 px maximum side, 16 megapixels per canvas, 100 layers and a total
  64-megapixel layer budget; 128 MB undo budget. Cloud project saves are limited to
  36 MB compressed / 200 MB expanded. Layer, mask and preview PNG dimensions and
  manifest geometry are checked before use. Larger work can be exported locally.
- PSD: 50 MB import, 8-bit RGB only. CMYK, high bit depth, PSB, native smart objects,
  editable PSD text and full effects/adjustment fidelity are not supported. Import
  reports compatibility warnings; export rasterizes transforms/masks into each
  layer's appearance. Nested groups flatten to one level. Group rotation/scaling,
  free-transform handles, arbitrary nested groups and Photoshop-grade healing are
  unfinished; the current healing brush is a softened sampled-clone operation.
- Canvas resize/crop is destructive but undoable, not a live adjustment layer.
  Plain text stays editable through cropping or uniform resizing. Transformed
  text, nonuniform text resizing, or a new font size outside 8–500 px requires
  rasterization to retain its appearance; the dialog warns before applying.
  Undo restores the editable text as well as its pixels and dimensions.
  Text and shape tools are not vector-design tools. PSD decoding still runs on the
  main thread within explicit size/memory bounds; pixel filters run in workers.
- Editable image bundles are used for saved projects, local recovery and export.
  Importing a local `.axiom-image` bundle through the general image picker is not
  yet available. Selections constrain brush/filter operations; shape tools do not
  yet clip to the selection mask.
- Math creation, checkpoints, visual input and OCR results are bounded at 30,000
  characters; raw collaborative Source mode can retain longer text. Macros are
  bounded at 15,000 characters and raster equation exports at 32 megapixels.
  Some visual-editor LaTeX constructs/custom macros require Source mode. No
  symbolic proof-checking claim is made.
- Text preview starts at 2 MB and can load up to 20 MB; huge lines/CSV cells are
  bounded. XLSX: 25 MB input, 100 MB expanded, 2 million preview cells across
  sheets, 100 sheets, 50,000 rows and 256 columns per sheet, 20-second timeout.
- Workbook selections are bounded to 10,000 cells / 2 MB of copied text. Formula-like
  literal strings are escaped in TSV exports. Up to 2,048 basic styles and 10,000
  merged ranges are retained; original files are never rewritten by viewer controls.
- DOCX/PPTX reading: 50 MB input, 200 MB expanded, 20,000 ZIP entries, 12 MB per XML
  part, 5 million extracted characters, 20,000 blocks, 1,000 slides and a 30-second
  worker deadline. DTDs/entities, unsafe archive paths, macro-bearing archives and
  embedded objects are rejected. No remote relationship is fetched. Text remains
  inert React content, not document-provided HTML. Word reading mounts 100 blocks
  initially and can reveal more; this is bounded loading, not full virtualization.
- Browser codec support determines which audio/video files play. Unsupported
  codecs and formats retain a protected original-file download.
- Provider-backed OCR/AI requires a configured provider; no provider is enabled by default. A
  consented request may leave the private deployment when OpenRouter is chosen.
  Source/images are not written into administration activity logs. Group request
  limits include cancelled/failed requests; do not assume an uncertain external
  request was unbilled. At most five pending AI jobs per account are accepted.
  PDF batch OCR has a separate opt-in [self-hosted CPU service](SELF_HOSTED_OCR.md),
  with private reviewed research text/searchable outputs and separate limits.
- Live text recovery uses the same access-epoch quarantine protocol as notes.
  Never resolve a stale anchor or lost image lease by silently replacing newer
  work. Save a copy or export retained source instead.

## Optional service configuration

See `.env.example` and [the private converter guide](../deploy/office-converter/README.md).
Configure the same `TOOL_PROVIDER_KEY` (32 random bytes, base64) for web and worker;
keep it in a secret store and retain it separately with disaster-recovery material.
Replacing it without migrating stored credentials makes those credentials unreadable.
Set `TOOL_PROVIDER_ALLOWED_ORIGINS` for approved private inference origins. Group
admins then add a model/credential and enable its capabilities in Providers.

Office conversion needs `OFFICE_CONVERTER_URL` and `OFFICE_CONVERTER_TOKEN` plus
the optional `research-tools` Compose profile. The converter runs non-root with
no public port, no DB/storage credentials, no external network, a read-only root,
bounded tmpfs, resource limits, and a fresh LibreOffice profile per request.
Do not run untrusted Office conversion directly on the developer workstation.

The local Docker daemon was unavailable during this verification. Compose service
configuration was validated, but the converter was not built/deployed and real
LibreOffice conversion was not accepted. No real OCR/AI provider was configured or
called. These are operational acceptance gates, not working external services.

## Historical tool-release verification

The following records preserve September 10–11 acceptance of the tool releases.
Their ports, totals and private screenshots are historical, not a rerun of the
current build. See [current verification and remaining gates](VERIFICATION.md).

Migration 12 is additive. A database/attachment backup was created and verified
before applying it to the live local database; the separate verification database
was migrated first. Source edits, uploads and collaboration tests run only against
the isolated 3002 web / 1235 sync / separate attachment store, not live notes.

- TypeScript, ESLint and the production build pass.
- Unit suite: 1,411 passing tests (including 23 tool contracts, seven source
  completion/library regressions and 12 math-image clipboard/export contracts).
- Tools and Explorer integration suite: 16 passing tests. Coverage exercises
  project copies, immutable restores, quotas, immediate visual typing,
  source-mode no-op round trips, peer edits/local undo, guarded note returns,
  aligned search/sheet controls, bounded row headers, DOCX downloads, local image
  recovery, immutable saves, stale/fenced-save rejection, private-resource access,
  consent requirements, uploaded text/CSV/XLSX/audio/Office preview routing and
  no-execution cached workbook formulas.
- Focused source-completion and library workflows also pass in Firefox and
  WebKit, including placeholder navigation, peer edits, saved-symbol filtering,
  exact insertion and light/dark presentation.
- Preview-action acceptance (2026-09-11): three Chromium checks and two each in
  Firefox/WebKit pass. Actual clipboard image/text reads run in Chromium; that
  check is explicitly skipped in the other engines. All three verify SVG/PNG/JPG
  downloads, nonempty image pixels, scaling, transparency/paper/ink colors,
  menu icons/dividers/focus restoration, unchanged source, stale/empty-render
  guards and denied-clipboard download recovery. The combined Chromium tools
  suite has ten passing checks. Fresh screenshots are in
  `data/math-preview-actions/{chromium,firefox,webkit}/`.
- Canvas browser checks cover pixel undo/redo, transformed selection/mask/filter
  coordinates, editable text recovery, bundle round trips, PSD raster/group
  interchange and unsafe-dimension/bit-depth rejection.
- Full Chromium/Firefox/WebKit editor suite: 1,011 passed and 27 explicitly skipped
  (opt-in performance runs and Chromium-only CDP cases on other browsers).
  Current reports and light/dark Math Studio screenshots are in
  `data/math-studio-refinement/`; the initial tool acceptance is retained in
  `data/research-tools-tests/`.
  Live 8080 smoke: 24 checks pass; current screenshots
  and the HTML report are refreshed under `test-results/latest-dev-8080/` and
  `playwright-report/dev-service/`.

Physical IME/clipboard/device acceptance, complex external Word/PSD fixture fidelity,
real provider execution and private converter acceptance remain manual gates.
Use `npm run test:dev` for read-only checks of the current 8080 service. Do not run
the mutating E2E suite against live research data.

## Implementation map

- `packages/editor/src/math-symbols.ts`: shared symbol insertion/preview catalog.
- `apps/web/components/tools/`: studio, viewer, provider and discussion interfaces.
- `apps/web/lib/tools/`: source binding, canvas engine, worker processing, drafts,
  PSD/OMML exporters and guarded note-return bridge.
- `packages/shared/src/research-tools-api.ts`: ACL-checked project/lease/save APIs.
- `packages/shared/src/tool-services-api.ts`, `tool-jobs.ts`, `tool-providers.ts`:
  provider administration, durable opt-in jobs and encrypted credentials.
- `packages/shared/src/file-preview-api.ts`, `file-detection.ts`: safe preview
  manifests/detection and version-owned private derivatives.
- `deploy/office-converter/`: isolated LibreOffice service and operator guidance.
- `scripts/build/vendor-tools.ts`: local MathLive fonts and third-party notices. No font
  CDN is needed; pinned MathLive, ag-psd, ExcelJS and file-type are MIT-licensed.
