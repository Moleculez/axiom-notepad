# Research media, references, and snippets

The editor's file workflows share the workspace's access checks and immutable
file versions. Markdown remains the authoritative collaborative document; there
is no separate rich-content database or serializer.

## Everyday workflows

1. Type `/image`, `/attachment`, `/pdf`, `/audio`, or `/video`. The insertion dialog
   has Library, Upload, and URL tabs, a searchable/filterable library, folder
   navigation, recent/favorite files, multiple selection, and a preview panel.
   Selection does not change the note until **Insert**. Escape cancels the intent.
2. Upload in the dialog to review first. Paste or drop files into the editor to
   upload and insert directly at the saved position, in selection order. Uploads
   supports progress, cancellation, pause, and retry. Finished files remain in the
   library if insertion is cancelled or its location becomes invalid. The current
   note's folder is the default upload destination. Batches are limited to 60 files.
3. Choose a text link, file card, inline preview, image, or numbered figure.
   In-app PDF/audio/video previews load only authenticated internal attachments.
   Unsupported inline formats retain an ordinary usable file link. External
   image previews require an explicit click; other external files remain links.
4. Expand **File identity & versions** to inspect location, readable file code,
   UUID, pinned version, and reference counts. Copy a code/link/ID, reveal the file,
   or select a historical version. References do not silently follow newer uploads.
5. Workspace Settings → General → **File reference codes** sets a prefix such as
   LAB. New files receive LAB-1, LAB-2, and so on. Codes remain stable after rename,
   move, or prefix change. Old prefixes and issued codes are reserved, not recycled.
   Search codes in Explorer or the insertion library. UUIDs remain canonical keys.
6. Numbered figures support Markdown/math captions, alternative text, alignment,
   width, and labels. `/figure` offers **Figure reference**; choose a labeled figure.
   Right-click a wrapped image/link → **Figure & presentation** to adjust it later.
   Duplicate and unresolved labels appear in document attachment checks.
7. PDF files offer insertion from saved annotations with page/version provenance
   and an optional citation key. Sharing a private annotation requires confirmation.
   Audio/video links can start at a chosen second. CSV/TSV files can insert a frozen
   table excerpt linked to the source version (1 MB input, 200 data rows, 20 columns).
   This does not run formulas or keep a live spreadsheet connection.
8. Hover or keyboard-focus an internal attachment link for compact **Open** and
   **Open beside** actions. **File identity & versions** retains location, copy,
   and reveal tools. Hover does not render a media preview or download file
   contents; only permission-checked metadata is fetched on demand. Explicitly
   inserted inline previews and the double-click image viewer are unchanged.
9. Search editor commands for **Check document attachments**. It reports missing
   or inaccessible versions, newer versions, empty image alternative text, and
   figure-label issues, with jump-to-occurrence actions. It never fetches external
   URLs or silently rewrites references.
10. `/snippets` opens personal/workspace snippets and built-in templates. Save a
    selection through **Save selection as snippet**, edit/name/tag/duplicate it,
    archive/restore it, and insert an independent Markdown copy. Workspace snippets
    require editor access to change. Archived snippets still protect their pinned
    file versions from purge. Revisions prevent concurrent silent overwrites.

## Portable representation

Ordinary links and images remain ordinary Markdown. Rich presentation wraps them
in a strictly validated, versioned comment envelope:

```markdown
<!-- axiom-media {"v":1,"display":"figure","label":"fig-spectrum","width":75,"align":"center","mime":"image/png"} -->

![Measured spectrum](/api/v1/attachments/11111111-1111-4111-8111-111111111111)

Energy response at $T=300\,K$.

<!-- /axiom-media -->

See [Figure](#fig-spectrum).
```

Other Markdown readers retain the image/link and caption, even when they ignore
the presentation comments. Axiom's reader, editor, HTML export, and published sites
share figure/card styling. HTML/print exports use static content, not live PDF or
media players. Publication continues to copy only reviewed, authorized assets.
Figure numbering is document-local; labels should be unique within a document.

## Maintenance and efficiency

- `packages/markdown/src/media.ts` validates metadata and collects media in a
  linear AST pass. Invalid/incomplete envelopes preserve their source. Figure
  indexes survive the existing conservative incremental parse fast path.
- `packages/editor/src/insertion-sessions.ts` tracks independent Yjs-relative
  intentions. Changed selections, deleted empty anchors, closed sessions, and
  document replacement reject stale insertion. No parallel document state is kept.
- Rich media node views put players outside editable content, defer loading until
  visible, and reuse unchanged views. Caption edits map to original source ranges.
- The picker uses debounced, cursor-paged server search and lazy image loading;
  browser content visibility avoids painting offscreen result rows. Preview modules
  are lazy-loaded. Local image object URLs and pending requests are cleaned up.
- Upload completion now records the exact version ID. Polling looks up transfers
  with a map and refreshes the workspace only on a new completion, rather than for
  every previously completed transfer on each poll.
- `media-assets` resolves up to 200 version identities per request and rechecks
  workspace scope. Missing and unauthorized versions share an unavailable response.
- Migration **34** adds codes, prefix reservations, snippets, version retention,
  and upload completion identities. Use the normal additive migration workflow;
  no development reset or compatibility rewrite is required.

## Verification and boundaries

The focused unit suite covers safe metadata, source mapping, figure numbering,
preview/export separation, and collaborative insertion guards. The isolated browser
suite `tests/e2e/editor-media-v2.spec.ts` uses port 3008 and disposable research data.
It exercises upload/review, caption interaction, concurrent editing and undo,
immutable codes, prefix changes, snippet conflicts/retention, access denial, and
source-mode cancellation. Do not run this mutation suite against working data.

Device-native clipboard/IME, mobile layouts, screen-reader acceptance, all storage
providers, every media codec, and large-workspace performance are not certified by
these tests. Dataset excerpts currently support CSV/TSV; workbook/Office files use
their existing viewers. Attachment checks report issues rather than bulk replacing
versions. Snippets are inserted copies, not synchronizing transclusions. External
link health is intentionally not probed to avoid sending private URLs to a server.
