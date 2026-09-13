# Image and Mermaid viewer

The desktop viewer is a shared inspection surface, not a new file format or a
second image editor. It never rewrites the document, diagram source, or original
image. Image Studio remains the place for destructive edits to a separate copy.

## Opening and navigation

Double-left-click a rendered image or Mermaid diagram in Write, Read, a canvas
card, or a stored-image preview. The small hover/focus button, context menu, and
Alt+Enter provide alternatives. Single-click retains the editor's existing image
source/diagram editing behavior; hover and right-click do not reveal source.
Closing restores the originating surface's focus and scroll position.

The gallery follows the current document's visual order. Canvas galleries use
visible, mounted cards; they do not fetch hidden cards recursively. Explorer
Quick Preview supplies selected images, or images on the current result page.
Images in a quick Markdown preview can be inspected without creating a second
collaboration provider; persistent markup requires the original saved document.

| Control                      | Behavior                                                             |
| ---------------------------- | -------------------------------------------------------------------- |
| Wheel/trackpad, + / −        | Zoom around the pointer / viewport center                            |
| Drag, or hold Space          | Pan without changing document/card positions                         |
| 0 / Fit                      | Fit the image in the available viewport                              |
| Width                        | Fit to viewport width                                                |
| 1 / 1:1                      | One image pixel per CSS pixel, independent of device pixel ratio     |
| Percentage                   | Direct intrinsic-scale entry, from 1% to 3200%                       |
| Left / Right arrows          | Previous / next visual, outside text inputs                          |
| Rotate / flip                | Temporary inspection transform                                       |
| Fullscreen / Escape          | Fullscreen (window expansion fallback); Escape restores, then closes |
| Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z | Viewer markup undo/redo, never document undo                         |

Fullscreen uses the inner viewer shell, keeping its title, close action and tools
visible; native dialog elements cannot be fullscreen targets. If the browser
blocks fullscreen or has no API, the same button expands the viewer to the browser
window. Escape restores the normal viewer first; press it again to close. Closing
the viewer also leaves its fullscreen session without changing the original file.

Comparison shows two authorized visuals with optional linked zoom/pan. Choose
another document visual or search accessible workspace images. Backdrops include
transparency checks, theme paper, white, and dark. Pixelated display, a sampled RGB
histogram, a color sampler and an uncalibrated pixel-distance ruler assist figure
inspection. These are displayed-image measurements, not color-managed scientific
metrology or physical units.

## Metadata and exports

The Information panel lazily reads available EXIF/IPTC/XMP/ICC metadata in a
terminable worker. Identifying GPS/location/serial/author fields are hidden until
explicitly revealed. Export respects that choice. No location lookup, map request,
third-party proxy, or image upload is performed by the viewer. Many screenshots,
SVGs and web images contain no metadata; diagrams have no EXIF.

Exports include PNG, JPG, WebP, original bytes, Mermaid source, Mermaid SVG, image
Markdown/address, and editable annotation JSON. PNG clipboard support depends on
the browser and OS; download is the fallback. SVG keeps Mermaid paths and optional
vector markup; it does not convert raster images to vectors. Include visible markup
is opt-in. Viewing rotation/flips are temporary and exports retain original
orientation. An animated-image raster export captures one frame. The original
download preserves its bytes, including any metadata the source contains.

An attached image can open its original file or start a separate Image Studio
copy. Exported images and markup JSON can contain private annotations: distribute
them intentionally. JSON is a portable inspection/recovery format; bulk import and
round-trip server restoration are not implemented.

## Placement-specific annotations

Arrows, rectangles, ellipses, freehand strokes, labels and region pins use
normalized coordinates. Select to move a mark; rectangle/ellipse/arrow endpoints
resize it. Color, line width, rich Markdown/math/code notes, resolve/reopen, removal
and session-local undo/redo are separate from document editing.

Annotations start private and belong to one placement, not to the image URL. Using
the same image twice does not duplicate its annotations. Inline documents show
only a small annotation count, not markup geometry. Live Markdown and canvas text
cards use Yjs-relative anchors; file cards include their version and canvas path.
Read-only embedded document snapshots are revision-bound. Changed or removed
placements remain available for explicit review/reattachment rather than silently
moving geometry. Replacing a file or changing diagram source/dimensions invalidates
the previous visual identity. A stale Mermaid preview is identified as the last
valid render.

Share annotation explicitly grants visibility to readers of that document and
requires comment access in an active group workspace. Only the author can edit it;
workspace managers can remove shared entries, never read other authors' private
entries. Shared entries support rich replies; an entry with live replies cannot
be made private. Sharing state changes on another device require conflict review,
not automatic publication of a retained private draft.

Local IndexedDB drafts are account-scoped. Local writes do not wait on network
requests. Reconnect replay continues after closing the viewer; failed or stale
mutations remain visible for retry, server-version selection, or JSON recovery.
Posting a reply durably queues it; text not yet posted in a reply composer is
transient. **Settings → Storage → Offline files & reading data** includes owned
visual annotations in the personal export. These caches are trusted-device data,
not end-to-end encrypted storage. Sign out follows the application's account-cache
cleanup contract; export unsynchronized work first.

## Security and bounds

- No byte inspection beyond 50 MB; metadata parsing times out after eight seconds.
  Compressed metadata expansion is bounded, and returned fields/strings are capped.
- Canvas pixel operations/raster exports are limited to 16 megapixels and 8,192
  pixels per side. Smaller export scales may fit; original downloads are unchanged.
- Remote images without readable CORS bytes remain viewable, but verified markup,
  pixel inspection, and converted-image export require an authorized readable copy.
- External SVG is displayed as an image, never injected into app HTML. Mermaid
  uses one serialized strict renderer, bounded source/edges and no external assets.
- APIs check document ownership scope, workspace lifecycle, referenced file access,
  author permissions, mutation IDs and optimistic revisions. Placement/file-version
  mismatches are rejected. Source fingerprints are client-computed identity checks,
  not a server attestation of remote contents.
- A document supports up to 5,000 entries including replies/tombstones. Individual
  notes are limited to 10,000 characters and freehand paths to 2,000 points.
- Online viewers revalidate access on workspace changes, focus, reconnect and
  periodically. Offline/untrusted devices cannot be made to forget previously
  downloaded data. This adds no background sharing, OCR, EXIF writing, or mobile UI.

## Implementation and deployment

Apply additive database migration **20** with `npm run db:migrate` in a native
installation; container startup uses the standard migration workflow. Back up the
database and stored files before a production upgrade. No reset is required.

- `visual-assets.ts` / `visual-surface.ts`: gallery identity, delegated gestures,
  source-safe editor/canvas adapters and inline counts.
- `VisualViewerHost.tsx`: one lazy dialog, account lifecycle and reconnect replay.
- `components/visual/`: viewport transforms, controls, inspectors and file preview.
- `visual-media.ts` / `visual-metadata.worker.ts`: bounded decoding, metadata,
  inspection and export. Heavy metadata code is not on the typing path.
- `visual-mark-store.ts`: durable local drafts, serialized replay and conflicts.
- `packages/shared/src/visual-annotations*.ts`: versioned contracts, migration and
  ACL-checked API. Geometry is independently tested in `visual-geometry.ts`.

The viewer uses semantic UI font/color/radius tokens, a restrained toolbar and a
single internal inspector scrollport. It is excluded from print. Do not let
document typography style its chrome or add markup to canonical Markdown.

ExifReader 4.45.0 is used unmodified under MPL-2.0; its source is available in the
installed package and at [the upstream project](https://github.com/mattiasw/ExifReader).
The worker's XML parser is @xmldom/xmldom 0.9.12 (MIT). Full distributed notices
are generated by `npm run tools:assets` in `public/tool-assets/THIRD_PARTY_NOTICES.txt`.
Exact dependencies are pinned in the lockfile. See [verification](VERIFICATION.md)
for measured acceptance rather than assuming full browser/device parity.
