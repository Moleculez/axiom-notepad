# Appearance and paper reading

Open Settings from the account menu or pages launcher, then choose Appearance.
Personal preferences remain separate from workspace access and group roles.
Account → My groups stays inside Settings; full administration is also available
below Your spaces in the persistent sidebar.

## Make the workspace yours

Theme supports System, Light and Dark modes, with independent light/dark palettes.
Choose paper, neutral, mineral and high-contrast looks, or the reviewed Paper
Research and Technical Slate theme packs. The visual editor changes semantic
colors for paper, text, links, controls, code, selection and focus. Contrast checks
flag risky combinations; arbitrary CSS and remote fonts are not accepted. Save
named themes or import/export validated Axiom theme JSON. Palettes store semantic
color overrides; theme packs additionally supply trusted application styling.

Under Theme → Navigation surfaces, choose Glass or Solid and adjust glass
intensity from 0–100%. Glass affects navigation, toolbars and dialogs only:
document, mathematics, code and PDF surfaces stay opaque. High-contrast palettes,
reduced-transparency preferences, increased OS contrast and unsupported browsers
fall back to solid chrome. Blur is never animated. Motion and shadow choices
remain independent.

**Try the modern look** previews Frost/Graphite with system-sans interface/headings and Source Sans 3 prose. Apply saves the preceding account appearance as a restore point without changing text sizes, reading metrics, saved palettes, motion/shadow choices or device overrides. **Restore previous appearance** previews that account-scoped snapshot; Apply swaps it with the current look. You can also select **Keep current look as a restore point** before applying any customization. There is one durable restore point, not a full appearance history. Offline restore intent is queued with the preference change and follows the normal conflict-resolution flow.

Typography separates the interface, prose, headings, and source/code. Choose among Inter, Source Sans 3, Source Serif 4, Latin Modern Roman, Atkinson Hyperlegible, JetBrains Mono, IBM Plex Mono and system families; code uses monospaced choices. Font files are served by Axiom, with local CJK fallbacks. Adjust role sizes/weights, heading scale, line height, paragraph spacing, letter/word spacing, math scale, and reading width. Font rendering still depends on your browser and installed fallback fonts.

Five optional document styles provide editable starting points: Modern (balanced sans), Journal (serif reading), Compact Research (more content in view), Accessible (distinct letterforms and larger text), and LaTeX Article (self-hosted Latin Modern Roman, 19px/1.65, 70ch and 14px IBM Plex Mono). They change document typography, not interface fonts, colors or device settings. Choosing a style previews its metrics; Apply saves and Cancel restores the preceding look. **Try it here** is a right-hand Write/Read/Source scratchpad beside the settings fields. Resize the split with its divider, scroll either pane independently, or hide the preview without clearing the sample. It never writes to a note or joins a collaborative session. Paper-like tables, flat code and unboxed equations share the document's type/color roles. Personal HTML export embeds Latin Modern's four faces for offline reading. See [settings behavior](SETTINGS.md).

Reading/layout also controls line wrapping, source/live-code line numbers, active-line highlighting, ligatures, focus mode, compact/comfortable rows, pane widths, corners, shadows, and reduced motion. Browser zoom remains available. Use **Preview → Apply** to save, or **Cancel** to discard a preview. Reset sections individually or reset all. The optional print/HTML typography setting carries reading fonts into exports without copying account information or a dark background into the exported document. The Editor and Keyboard shortcuts sections have separately synchronized writing preferences; restoring a previous appearance does not reset them. See the [editor guide](EDITOR.md).

Account defaults follow you across devices. Device overrides apply only to this account in this browser: interface scale, density, sidebar width and context-panel width. Offline changes remain local until reconnection. Independent settings merge; conflicting settings display a choice. Storage errors are reported, not treated as successful saves. Appearance never changes Markdown or resets the collaboration document.

LaTeX Article enables H1–H3 bottom rules, decorative hierarchical section labels (`§ 1`, `§ 1.1`, `§ 1.2`, `§ 2.1`) beside resting H1–H6, and academic double-rule dividers. Numbering follows actual heading ancestry; starting at H2 or skipping levels creates no phantom zero parents. Typography → Document decorations can turn them off without changing fonts. Font/size/spacing and color adjustments retain the decoration choice; another document preset selects its own decoration default. Personal HTML and print retain the same ornaments, but headings in the app and outline are not decorated.

Existing profiles and device caches normalize to appearance schema v9, including
pending offline changes. Saved typography and decorations are retained; missing
block-guide, reading-mark, minimap and PDF-reader fields receive their current defaults.
Appearance → General controls folding guides, margin marks and the optional
[document minimap](MINIMAP.md). Already-open older app clients must reload before
saving appearance; unrepresentable choices produce a reload response rather than
silently replacing settings. Portable palette files still use `axiom-theme`
version 1. Writing preferences remain v2.

## Navigate a document

The Outline tab is a nested table of contents. The first/root heading is flush; each actual child adds 16px of indentation. An H2-starting note has no empty H1 level, and jumps such as H2 → H4 create one real child level, not phantom gaps. Repeated titles keep their distinct parser-generated anchors.

Use the disclosure arrows or Expand all/Collapse all to manage long outlines. Collapses are remembered separately for each note during this app session, not synchronized into the shared document. The active section follows the caret in Write/Source and manual scrolling in all three modes. Opening a heading link or bookmark reveals its ancestors. The outline uses ordinary nested lists, buttons and accessible current-section/disclosure states; Tab navigates controls without introducing a partial tree-widget keyboard model.

Dialogs are centered on the viewport with internally scrolling content and visible actions. Escape closes a dialog, Tab remains inside it, and focus returns to its opener. Clicking padding or dragging from inside to outside does not dismiss it; a genuine backdrop click does.

## Read and annotate PDFs

See the [PDF research workbench guide](PDF_READER.md) for the redesigned layout,
selection popups, collapsible contents, bookmark editing, page organization and
explicitly configured paper assistant, including current limits.

For images and Mermaid diagrams, double-click the rendered visual to inspect,
compare, export, or add placement-specific private annotations. See the
[image/diagram viewer guide](VISUAL_VIEWER.md) for metadata privacy and limits.

Attach a PDF to a note and open its attachment card. On desktop, drag the divider or use its arrow keys to resize the paper pane. On narrow screens, switch between Note and Paper tabs without discarding the editor. The reader supports page navigation, fit-width/zoom, rotation, PDF outline, lazy thumbnails, text selection, and cancellable text search.

Select text to highlight it, choose **Area** to mark a figure, or add a **Page note**. Annotations are private by default and belong to their author. **Share with readers** explicitly exposes an annotation to people who can read that paper. Group administrators may remove shared annotations but cannot inspect another member's private annotations. Annotations use normalized page coordinates and stay attached across zoom and rotation; modified PDF bytes do not silently reuse old anchors.

**Insert quotation** saves the annotation and inserts escaped Markdown with a page/annotation link and citation key when available. Inserting private content into a shared note asks for confirmation. The copied text becomes part of that note; making the annotation private later does not retract an already copied quotation. Export your annotations as Markdown or JSON from the annotation panel.

Text search and selection need a PDF text layer. Scanned papers still allow
area/page notes; opening a PDF does not run OCR. Optional provider-assisted OCR is
a separate, explicitly configured workflow. The full reader prompts for a password
when required; unsupported or malformed files report an error. Explorer supports resumable files up to 1 GB; the legacy attachment
endpoint is limited to 50 MB. The annotation reader asks before loading PDFs over
100 MB. Rendering is page-based, not an unlimited multi-page canvas; complex files
may still be expensive on low-memory devices. See [file-viewer limits](RESEARCH_TOOLS.md).

## References and personal reading

The reference library is group-shared; your reading status, saved filters, bookmarks and progress are personal. Filter by title/identifier, author, year, linked project/tag, or reading status; save useful filter combinations. Use Want to read, Reading, Read and Archived to maintain a personal queue.

Edit metadata without changing the citation key. BibTeX updates retain the existing entry type and unedited/uncommon fields. Import `.bib` files or manually add references. **Look up metadata** sends only a DOI/arXiv identifier to Crossref or arXiv and shows a preview before you adopt it. Provider lookup needs connectivity and can be rate-limited. Duplicate identifiers/titles produce a warning. Link related notes and their PDFs to a reference to open them from the library.

Bookmark a note block, passage or paper page; manage labels, tags, colors,
deletion/Undo and exports in the document's Reading marks panel or
**Settings → Storage → Offline research**. Right-margin markers and the overview
rail show saved locations. New note bookmarks use Yjs-relative anchors;
deleted/replaced targets explicitly need reattachment. Older heading/scroll
bookmarks keep their fallback. Private-first rich annotation cards sit beside the
same blocks and can be explicitly shared into Discussion.
See [reading marks and annotation cards](READING_MARKS.md).

## Offline data and privacy

Choose **Keep offline** separately for each paper. Offline reading requires the production shell to finish installing online first. PDF bytes are account-scoped local data, not service-worker API caches. Removing an offline copy leaves notes and annotations intact. The data settings page shows pinned papers and estimated browser usage; it can unpin individual papers or clear PDF copies only.

Private annotations and personal reading changes use a local outbox. Reconnection retries them; revision conflicts need review instead of silently replacing authored text. Reading positions reconcile automatically. If access is revoked, the app removes downloaded paper copies on its next successful access check and retains unsynchronized personal work for export. It cannot recall files from a disconnected or untrusted device.

The personal JSON export includes this account's cached preferences, reading records and owned annotations; it is not a complete server backup or an import/restore format. Group archives do not include private reading data. Use the administrator database/blob backup tool for disaster recovery. Signing out clears the account's local notes, appearance and research data and locks its other tabs; export unsynchronized work first. This is trusted-device storage, not end-to-end encryption or protection from the server administrator.
