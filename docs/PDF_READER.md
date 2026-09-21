# PDF research workbench

Unsent annotation replies now persist on the current device/account, including
their edit revision and retry identity. Reopening requires a fresh permission
check before recovery; drafts never send automatically. Send, discard or sign out
to clear them. Storage failures are reported instead of silently discarding work.

**Link task** connects an annotation to an existing or new task in the paper's
workspace, preserving file version/page/annotation identity. Private text is not
copied into the task; link visibility follows current paper/annotation access.
Deleted or pruned source versions never redirect to a different version.

The PDF reader is a research-oriented workbench, inspired by Zotero's reading
workflow, not a claim of feature parity. It opens immutable file versions inside
the existing workbench and beside Markdown notes. Your source PDF is never edited
by annotation or display controls. See [Zotero's reader guide](https://www.zotero.org/support/pdf_reader)
for the reference workflow.

## Reading and navigation

- A compact toolbar and resizable left navigator replace the old stacked panels.
  The navigator contains annotations, contents, page thumbnails, bookmarks and
  search. Footer status stays outside the scrolling pages.
- Continuous, single-page and facing-page layouts; fit-width, fit-page and numeric
  zoom; display rotation, fullscreen and page-navigation history.
- Contents is a quiet collapsible hierarchy with aligned page labels and a current
  section marker. Filtering is optional and keeps matching sections' ancestors.
  Arrow keys on a section button open/close its children; Tab visits controls.
- Text search lists individual occurrences, with case and whole-word options.
  Next/previous moves to the exact highlighted occurrence. Search is bounded to
  2,000 results; refine the query when this limit is reached. Scanned pages need OCR.
- Split view shows two locations in the **same** PDF. **Compare PDFs** opens another
  authorized file/version beside it, with independent zoom, swapped panes, linked
  pages/scrolling and manual page alignment when unlinked. Its bounded worker
  compares extracted text, aligns inserted/deleted pages and navigates word-level
  differences. Blank/scanned pages are marked unavailable, never silently identical.
  Explicitly choose reviewed private OCR text for scanned pages; OCR never starts
  automatically. Text comparison cannot detect image-only/layout changes.
  Embedded page links and safe HTTP(S)/mailto links work;
  JavaScript/file/data actions are not executed.
- Page bookmarks can be renamed, removed and restored with Undo. Resume stores the
  page, normalized intra-page offset, zoom, rotation and layout in private reading
  data. Explicit page links override the saved position. Restoration waits for
  nearby page dimensions; user scrolling cancels a pending restoration.
- Appearance → General adds PDF defaults: layout, navigator width/visibility,
  Original, Warm paper, Graphite surround and High contrast surround. Only Warm
  intentionally tints displayed page pixels; source/export colors stay unchanged.
  Appearance schema v9 retains older preferences and down-projects v8 reads.

## Selection and annotations

Selecting a word or passage shows a compact floating action bar. **Selection alone
does not open the annotation editor or change panel layout.** The bar offers four
private highlight colors, underline, strikeout, copy, insert quotation with a page
citation, and Add note.
Only Add note opens the annotation editor. Escape, outside click or scrolling
dismisses the bar. Mouse selection is not stolen when its actions are clicked.

Text highlights, underlines, strikeouts, area highlights, page notes, pen strokes,
arrows and text boxes retain normalized
PDF geometry and private-first persistence. Edit an owned annotation, explicitly
share it when authorized, remove it, or Undo its removal. Filter by author/scope,
color and text (including tags); export filtered annotations as Markdown or JSON.
Each annotation can carry up to 12 tags. Selections spanning up to 20 rendered pages
and 200 rectangles remain one annotation with multiple page segments. Quotes retain
immutable attachment/page links. Standalone reader insertion currently copies
Markdown to the clipboard; the note-side reader inserts through its existing
editor callback. Private-material warnings remain in place.

Use **Drawing tool** for pen/arrow/text-box creation. Selected owned drawings have
drag/resize geometry controls that respect page rotation. Undo drawing is conditional
on no intervening annotation mutation. Text-box content uses the regular annotation
composer. Existing text-markup and area geometry does not yet have equivalent handles.

**Discuss** opens a thread attached to one synced annotation. Replies can be edited
by their author; authorized managers may remove shared replies. Resolve/reopen,
unread reply counts, optimistic-version checks and idempotent reply submissions are
included. Thread visibility follows the annotation: making it private immediately
denies other readers. Unsaved replies persist on the current device/account,
including after a network failure or closing the dialog. Recovery requires a fresh
permission check, so offline drafts are not an automatic-send outbox. Send or
discard explicitly; storage failures are reported. OS notifications are not
implemented. Workspace events invalidate annotation data, with polling as fallback.

Bulk-select up to 100 owned, synced annotations to tag, recolor, change visibility or
remove them. Sharing and removal require confirmation. Each result is
reported independently; Undo uses returned versions and refuses intervening edits.

**Import embedded annotations** previews native PDF highlights, underlines,
strikeouts, rectangles, text notes, free-text boxes and ink before making private Axiom copies. Imported
authors are labels, not account identities. Already-imported source identifiers
are skipped for the current author/version. Import is bounded to 500 new marks;
Cancel stops remaining work but retains already-saved copies. Concurrent imports
in separate browser tabs use an atomic source-ID guard. Arbitrary native line/arrow
imports remain unsupported because their full direction/ending semantics are not retained.

**Export annotated PDF** adds portable standard PDF annotations to a downloaded
copy. It uses the current annotation filter and excludes private Axiom annotations
until explicitly included. Original embedded comments remain present and may
already contain sensitive material; review before sharing. Explicitly included
imported marks replace their matched native marks, and stable export IDs prevent
repeat-export duplication. Unselected native marks remain. Unicode author
labels, text and tags are retained. Export verifies source hashes, refuses forms
and signatures, and is bounded to 100 MiB input / 200 MiB output, 2,000 annotations,
10,000 rectangles and 60 seconds. This is not redaction or flattening.

Ink, arrow and free-text dictionaries are exported alongside text/area annotations.
Cross-application drawing appearance, especially Unicode free text, still needs
desktop-reader acceptance. This is not a flattening or redaction tool.

## Page organization

**Reader view and file actions → Organize pages** creates a reversible local draft:
select ranges, keep/extract selected pages, remove, duplicate, drag or move pages,
rotate, merge local PDFs, and Undo the last 20 arrangement changes. Export runs in
a worker with a 60-second deadline. Sources are limited to 100 MiB combined and
outputs to 2,000 pages / 200 MiB. Encrypted PDFs and form/signature editing are not
supported; form-bearing sources are refused rather than silently stripped.

**Download arranged copy** creates a separate file. The original bytes, annotations
and citation targets remain unchanged. Document outlines, internal destinations
and Axiom annotation overlays are not transferred to the copy. Review the copy
before use. **Save to workspace** adds destination/name selection and defaults to a
new file. Saving a new version requires both the version originally opened and the
resource revision to match at upload initialization and final commit. A concurrent
replacement cannot silently overwrite; a failed replacement can be recovered as a
separate file. Network retries reuse the upload identity/chunks and prepared bytes
can still be downloaded. Generic replacement uploads use the same safety contract.

Annotation transfer is explicit, not automatic. Up to 500 visible synced marks are
mapped for original-source page reorder/rotation/duplication and copied privately
with original-author labels. Removed segments require acknowledgement; merged local
sources do not implicitly import annotations. The file version, provenance and
mapped annotations commit together. Source comments/discussions remain at their
original immutable citations. Annotated download is separate and preserves page order.

## Self-hosted batch OCR

**Batch OCR** provides a private durable queue for selected pages, reviewable
research text/LaTeX and an optional searchable PDF. Review corrections affect
research text only, not the machine-recognized hidden PDF layer. Equation previews,
reviewed Markdown exports, private-note creation, cancellation/retry and explicit
copy/version saving are included. No external AI provider is required.

Both service profiles are disabled by default. See [CPU OCR setup and acceptance
gates](SELF_HOSTED_OCR.md) for engines, languages, model provisioning, limits,
retention and deployment checks. Real container recognition has not yet been verified.

## Private paper assistant

An administrator must explicitly configure an encrypted processing provider and
enable its **paper** capability. OCR additionally requires **ocr**. No model is
enabled or contacted automatically. An authorized reader can:

1. Select a provider and Explain, Summarize, Question, Translate or OCR task.
2. Choose physical page numbers and prepare the context **locally**.
3. Inspect the exact extracted text (or bounded current-page raster for OCR),
   edit the request, and explicitly consent to that provider receiving it.
4. Submit once, continue reading, cancel a pending request, copy/insert a response,
   or delete private history. Cancellation cannot recall an already submitted call.

Text requests are bounded to 20 pages / 30,000 characters; larger contexts are
rejected, never silently truncated. Provider OCR is one page at a time; the separate
self-hosted batch workflow is described above. Provider batching, retrieval,
chat continuation, streaming and rendered math answers remain
pending. Responses currently use plain text to avoid executing model-supplied
markup, images or actions. Only `[p. N]` citations whose markers occur in submitted
evidence become navigation buttons; this checks context membership, **not factual
correctness**. Every request is pinned to its immutable PDF version and owned by
the submitting account. Provider access, file access and capabilities are checked
before processing. Private history deletion clears prompt/result but preserves
the quota receipt. Provider keys, deployment retention and worker configuration
retain the existing [research-tools controls](RESEARCH_TOOLS.md).

No paid/external model call was used for the reader's acceptance tests. Real OCR,
provider behavior, provider billing/retention and large-paper workloads require
deployment-specific acceptance. AI text is evidence to review, not verified proof.

## Implementation and limits

- `components/PdfViewer.tsx` delegates to `components/pdf/PdfReader.tsx`; Quick
  Preview uses the same `PdfPages` rendering surface with reduced controls.
- PDF.js loads authenticated ranges when the server supports them. Pinning and
  original/page-copy export necessarily read full bytes. Passwords stay in the
  current opening session. Main-view raster/text work is limited to nearby pages,
  plus one split-reference page; canvases are capped at 8 million pixels each.
  Continuous/facing layouts virtualize page shells as well as raster/text layers.
  Measured dimensions refine estimated slots while retaining the visible anchor;
  bounded overscan and selection anchoring keep the DOM independent of total page
  count. A generated mixed-size 1,000-page fixture is covered; broader real papers,
  physical cross-page selection, CJK/password and accessibility remain release gates.
- Rendering uses an offscreen buffer before swapping, cancelable jobs and
  normalized PDF geometry. Unused canvases are cleared. CMaps, fallback fonts and
  decoders are self-hosted: `npm run tools:assets` prepares development assets;
  production builds prepare them automatically. The generated PDF.js directory is
  not source-controlled or linted; third-party notices are retained.
- Multiple mounted readers register independent research subscriptions. Existing
  outbox conflicts and permission-revocation behavior are preserved. Changes poll
  periodically and react to existing workspace SSE invalidation events.
- Annotation-to-task links and local unsent-reply recovery are implemented. Full
  peer-collaborative side notes, broader reference/assistant context unification,
  durable multi-pane reader sessions and richer MCP operations remain follow-up work.

See [verification](VERIFICATION.md) for the executed test scope and outstanding
release gates. Existing files/data and prior Workspace/Gantt work are preserved.
