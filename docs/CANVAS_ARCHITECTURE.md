# Canvas platform · internal schema v1

## Ownership and boundaries

`packages/shared/src/canvas.ts` validates persisted cards, edges, commands and JSON
Canvas interchange. New rooms carry `schemaVersion: 1`; unsupported versions are
rejected visibly. External JSON Canvas has an explicit import/export boundary;
imported IDs are remapped and imported geometry is manual. This is interchange,
not a compatibility promise for old development datasets.

The Yjs root owns a map per card/edge and an ordered ID array. Text is nested
`Y.Text`, never a replaced JSON blob. `CanvasTextCard` reuses the application's
writing/source adapters and binding, including composition mapping and local
history. `CanvasStudio` owns transient selection, camera, pointer previews,
inspector and commands. Extracted modules own geometry, clipboard, preview
renderers, sizing election, templates, properties and export flows.

Document state includes title/tags, geometry, optional lock, height mode, image fit,
preview page, file reference/pin, edge ports/arrows/color/label. Camera, selection,
active embeds, renderer output, resource permissions and private preview bodies
are **not** document state. Locking means position/size only, not read-only content.

## Gestures and sizing

There is no double-click creation path. N, the dock and context menu create cards;
double-click or Enter edits a text card/activates a preview. Text inputs own their
native shortcuts. Canvas copy/cut/paste preserve internal connections and use
fresh IDs. Denied clipboard permission remains visible and does not cut content.

Drag previews are local. A completed move rebases its delta on current shared
coordinates; concurrent text/property edits are preserved. Manual resize opts out
of auto-height. Ports use screen-sized hit regions and choose the actual port or
nearest card side. Curves crossing endpoint interiors fall back to outward routed
paths. Connection properties provide keyboard-accessible reconnection and arrows.

Automatic height is derived from unscaled content, with fixed width and a
120–800 logical-pixel range. IME pauses measurement. An active writable editor is
preferred; otherwise the smallest eligible awareness client ID owns sizing.
Readers never publish sizes. Measurements check the current node again before
writing, never move neighbors, and use a distinct origin excluded from Undo.
Awareness is ephemeral coordination, not an authorization source.

Document-level connection interruptions disable authoring until a fresh access
token is obtained. A five-second watchdog retries automatically; the footer also
offers an explicit reconnect action. Permission/generation failures retain the
draft and require recovery rather than silently retrying stale authorization.
“Saved locally” is acknowledged only after the IndexedDB transaction completes.
The navigation guard also protects pending deletions that leave a document empty;
force-closing while it warns can still lose an in-flight write.

## Previews

`GET /api/v1/resources/:id/card-preview` reauthorizes the target resource and
delegates stored-file handling to the existing private preview manifest. Native
documents carry their source format, source, settings and revision. New file cards
follow latest; only stored files can pin an immutable file version. No access
decision is stored in Yjs. Loading, missing, denied, cycle, decode and retry states
do not replace or delete the original reference.

The client bounds simultaneous requests, debounces workspace invalidations and
unmounts offscreen card renderers. Nested canvases are read-only, viewport-limited,
cycle-checked, and at most two levels deep. Interactive viewers require activation;
media never autoplay. Webpages make no request until explicitly loaded. Embeds are
restricted HTTPS iframes without same-origin privileges, referrers, camera, microphone
or location. Local/numeric/private-style hostnames and same-app embeds are rejected.
Sites can block embedding; opening externally is always available. There is no
arbitrary server-side URL proxy.

## Exports

The dialog freezes the board, selected IDs and viewport on opening. Visual export
reauthorizes the board and linked resources, then stages a read-only scene separate
from the live editor. It reuses MathRendering and licensed application fonts.
Geometry/connections are SVG; rich cards are raster captures. SVG is not advertised
as editable vector text. Web/media cards export statically. Failed captures are
labeled and listed, not silently dropped.

Limits: 120 visual cards, 32 megapixels per raster, 64 megapixels of card captures,
100 landscape A4 PDF tiles, resolution 1–4×. Cancel prevents downloads and further
work between renderer steps; an in-flight browser rasterization may finish before
the cancellation check. JSON Canvas and Markdown are source-only exports.

Portable ZIP uses the existing durable workspace export queue, not an in-browser
archive of private cached responses. The worker holds a consistent database/blob
snapshot, rechecks every dependency, uses relative paths, and emits `.canvas`,
lossless internal snapshots, card Markdown, native sources/settings, stored assets,
and a manifest with exact versions, SHA-256 checksums and omissions. External pages
are links. Bounds: 1,000 dependencies, 8 dependency levels, 25 MB source, 100 GB
assets. Download reauthorizes every included resource, including deletion checks.
It is a research export, not an account backup.

## Discussions and testing

Resource comments support a `canvas-node` anchor. The API checks the target is a
saved card in an authorized canvas. Commenters may discuss without editing cards.
Threads on removed cards stay readable and explicitly labeled; resolving/deleting
comments follows existing author/manager rules.

Pure tests cover validation, concurrent property/text changes, local Undo,
composition rebasing, all port combinations, target selection, arrangements,
clipboard ID remapping, sizing election, export escaping/limits and theme guards.
Browser tests must cover actual drag hit regions, no double-click creation, nested
previews, permission loss, exports, keyboard controls and multiple collaborators.
Physical IME and platform clipboard acceptance remain manual release checks.

Development reset/setup and dataset identity are documented in `DEVELOPMENT_RESET.md`.
Themes must follow `THEME_AUTHORING.md` and `DESIGN_SYSTEM.md`; no pack may redefine
Canvas geometry or editor behavior.
