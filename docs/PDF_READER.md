# PDF research workbench

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
- Split view shows two locations in the **same** PDF. Comparing different files
  is not implemented yet. Embedded page links and safe HTTP(S)/mailto links work;
  JavaScript/file/data actions are not executed.
- Page bookmarks can be renamed, removed and restored with Undo. Page-level resume
  and private research records use the existing reading-data synchronization.
  Precise intra-page scroll/zoom restoration is not implemented yet.
- Appearance → General adds PDF defaults: layout, navigator width/visibility,
  Original, Warm paper, Graphite surround and High contrast surround. Only Warm
  intentionally tints displayed page pixels; source/export colors stay unchanged.
  Appearance schema v9 retains older preferences and down-projects v8 reads.

## Selection and annotations

Selecting a word or passage shows a compact floating action bar. **Selection alone
does not open the annotation editor or change panel layout.** The bar offers four
private highlight colors, copy, insert quotation with a page citation, and Add note.
Only Add note opens the annotation editor. Escape, outside click or scrolling
dismisses the bar. Mouse selection is not stolen when its actions are clicked.

Text highlights, area highlights and page notes retain the existing normalized
PDF geometry and private-first persistence. Edit an owned annotation, explicitly
share it when authorized, remove it, or Undo its removal. Filter by author/scope,
color and text; export the filtered annotations as Markdown or JSON. Quotes retain
immutable attachment/page links. Standalone reader insertion currently copies
Markdown to the clipboard; the note-side reader inserts through its existing
editor callback. Private-material warnings remain in place.

Underline/strikeout/ink/text/arrow tools, annotation geometry editing, native PDF
annotation import, multi-page highlights, tags, bulk operations and threaded
annotation comments are still pending. The existing file Discussion panel is
available, but is not an annotation-specific thread system.

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
before use. Saving directly as an application file/new version, mapped annotation
transfer and embedded-annotation PDF export are not implemented yet. This is not
a redaction or signature tool.

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
rejected, never silently truncated. OCR is one page at a time. Whole-document
batching, retrieval, chat continuation, streaming and rendered math answers remain
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
  Continuous layout still retains lightweight page shells in the DOM, so full
  1,000+ page DOM virtualization is a remaining performance gate.
- Rendering uses an offscreen buffer before swapping, cancelable jobs and
  normalized PDF geometry. Unused canvases are cleared. CMaps, fallback fonts and
  decoders are self-hosted: `npm run tools:assets` prepares development assets;
  production builds prepare them automatically. The generated PDF.js directory is
  not source-controlled or linted; third-party notices are retained.
- Multiple mounted readers register independent research subscriptions. Existing
  outbox conflicts and permission-revocation behavior are preserved. Changes poll
  periodically; immediate SSE invalidation is not implemented.
- Full peer-collaborative side notes, reference/assistant context unification,
  annotation-to-task workflows, durable per-file reader sessions and richer MCP
  operations are follow-up work, not hidden completed features.

See [verification](VERIFICATION.md) for the executed test scope and outstanding
release gates. Existing files/data and prior Workspace/Gantt work are preserved.
