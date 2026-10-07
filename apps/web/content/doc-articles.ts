/** Authored user documentation; never user HTML, executable MDX or remote content. */
export type GuideBody = { markdown: string; sample?: string };
const fence = (language: string, source: string) =>
  "```" + language + "\n" + source + "\n```";
const guide = (sections: [string, string][], sample?: string): GuideBody => ({
  markdown: sections
    .map(([title, body]) => `## ${title}\n\n${body}`)
    .join("\n\n"),
  sample,
});
export const guideBodies: Record<string, GuideBody> = {
  "editor/mindmap": guide([
    [
      "One document, another view",
      "Choose Mind map in a note's toolbar, or create a Mind map file from Explorer. Document returns to writing; both views share canonical Markdown, collaboration and author-local undo. A first, single document-wide H1 becomes the root; headings and nested bullet/number/task items form branches. Code, math, tables and media retain compact summaries and Block details. Definitions and metadata remain supporting source.",
    ],
    [
      "Edit and navigate",
      "Click to select, double-click or F2 to edit a heading/list label. Enter applies and Escape cancels. On a node, Enter adds a sibling and Command/Ctrl+Enter adds a child. Arrow keys navigate, Space folds, and Tab stays ordinary focus navigation. Task checkboxes update their Markdown marker. Search followed by Enter reveals and focuses matches. Source or Command/Ctrl+/ opens the resizable canonical pane.",
    ],
    [
      "Move deliberately",
      "Drag to another branch: its top/bottom edge means before/after, center means child. Alt+Up/Down reorders, Alt+Left outdents. Container crossings, implicit conversions, ambiguous indentation and headings below H6 require Source. Backspace/Delete confirms branch removal. Peer changes and current access are rechecked; conflicted label drafts stay copyable, not silently applied. Apply or copy drafts before switching file or view.",
    ],
    [
      "Presentation and export",
      "Display controls direction, spacing, theme-based colors, width, initial depth and all-branch folding. Your camera and preferences are account/file-local. Export a map or branch as exact Markdown, SVG, PNG, PDF or self-contained interactive HTML, excluding private comments, presence and reading records. Rich capture is capped at 120 nodes; larger maps may use vector text or Markdown. This source increment still requires browser, collaboration and migration acceptance; see docs/MINDMAP.md.",
    ],
  ]),
  extensions: guide([
    [
      "Opt in, one workspace at a time",
      "Open Settings → Extensions. Install a package, enable it for your account, then review permissions for one active workspace. Team/project workspaces require manager approval of the exact package hash before each member grants their own access. All packages start disabled; third-party imports have a separate server security gate.",
    ],
    [
      "Expiring permissions",
      "Individual permissions and group approvals last 30 days; the earlier expiry wins. Renew approval and Renew permissions require explicit review of the exact package and workspace scope. Renewal does not revive an old queued proposal or restart a worker. Files and completed work stay intact.",
    ],
    [
      "Native research helpers",
      "Research Journal prepares daily, laboratory and meeting notes. Document Health checks a saved Markdown snapshot and links findings to unchanged source. Planning Brief summarizes current tasks and milestones, not historical accomplishments. Panels use Axiom's shared controls and theme. Extensions require an online session; downloaded Markdown editing remains available offline.",
    ],
    [
      "Review changes separately",
      "Extensions can prepare Markdown-file, document-edit and task proposals, never apply them automatically. Inspect the exact native preview and destinations before Apply. Existing source transactions, audit attribution, retries and guarded Undo remain authoritative. Disabling/revoking access blocks future calls, queued actions and Undo; it does not reverse completed work.",
    ],
    [
      "Keep control",
      "Safe mode stops extensions on this device. Stop or Close ends a worker. Search & commands → Show extension inspector returns to a hidden retained panel; restarting explicitly reloads it. Settings drafts survive category/package switches and stale saves are blocked. Updates disable the package and require renewed consent; rollback restores one prior package/configuration without rewriting files.",
    ],
    [
      "Activity and authoring",
      "Extensions → Activity shows method/outcome metadata and pending proposal controls, including cancellation after disable. Toolbar → Activity & recovery links existing job controllers and never automatically retries work. The local TypeScript SDK and packaging command are documented in docs/EXTENSIONS.md. Packages run in opaque browser workers, without app DOM, arbitrary network or server execution. This controlled beta is not certification of hostile third-party plugins.",
    ],
  ]),
  "start/overview": guide([
    [
      "A file-first workspace",
      "Notes, Canvas boards, equations, images and other files live together in Explorer. Opening a file selects its editor or viewer; there is no separate tool project area. Use the location trail and Back/Forward to return to your work.",
    ],
    [
      "Make your first note",
      "Open a workspace or folder, then use its new-file/context menu to create a Markdown note. Give it a useful name, write a question, and add the evidence you will need. Personal work is private; shared work belongs in an appropriate team workspace.",
    ],
    [
      "Find your way",
      "Quick access contains Recent, Favorites, Review inbox, Audit and Trash. References live in each workspace's Research tab. The sidebar is a directory: enter a workspace or folder to see its contents, then go Up to its parent. Search & commands finds files and destinations. Docs, immediately to its left, opens this guide.",
    ],
    [
      "Try without changing files",
      "Editor and Canvas examples in this guide are temporary in-memory playgrounds. Open one explicitly, experiment, and reset it. Leaving the article discards the sample; no file, collaboration connection or cloud save is created.",
    ],
  ]),
  "editor/basics": guide(
    [
      [
        "Three views of one document",
        "Write is the structured visual editor. Source exposes the canonical Markdown. Read removes editing controls for comfortable reading. Changing views does not create a second document. Use the mode switch or the Toggle Write / Source shortcut shown in Commands & keyboard shortcuts.",
      ],
      [
        "Format as you write",
        "Use **bold**, _italic_, `inline code`, links, highlights and strikethrough. Select text for contextual formatting, or use commands. The active prose line may show inline Markdown so you can edit precisely; structured blocks keep their dedicated interactions.",
      ],
      [
        "Insert with slash commands",
        "Type / in an editable paragraph and search for a block, image, attachment or snippet. Arrow keys choose an item, Enter inserts, and Escape dismisses. File insertion opens a review dialog; choosing an item alone does not edit the note.",
      ],
      [
        "Recover and revise",
        "Undo and redo apply to your edits. Pay attention to the save/sync indicator: a local save is not the same as server confirmation. Do not close a disconnected session before retaining important unsynchronized work. Commands that require a workspace are intentionally disabled in this playground.",
      ],
    ],
    "# A research question\n\nTry **bold**, _italic_, and /table.\n\nWhat would change our conclusion?\n",
  ),
  "editor/structure": guide(
    [
      [
        "Headings and sections",
        "Type # through ###### followed by a space for headings. Heading typography stays visible with editable hashes while writing; rendered sections can display numbering and section marks. Use the outline to navigate the hierarchy.",
      ],
      [
        "Lists and task items",
        "Type - or * followed by a space for bullets, a number followed by a period and space for numbering, or - [ ] followed by a space for a task. Completed markers render as markers, not source text. Enter creates another item; Command/Ctrl+Enter makes a line break within an item. Enter on an empty item exits one nesting level. Indent/outdent commands help build nested lists.",
      ],
      [
        "Quotations and callouts",
        "A > followed by a space begins a blockquote; a lone > remains ordinary input. Empty-line exit behavior leaves a real paragraph boundary so following text is not swallowed by the quote. Slash commands also insert note, warning, theorem, proof, definition, lemma and research-question callouts.",
      ],
      [
        "Dividers and empty blocks",
        "A divider stays rendered when clicked; remove it through normal keyboard deletion. Empty rich math/code editors return to their opener when deleted. Block guides and folding are optional Appearance controls, not extra characters in Markdown.",
      ],
    ],
    "# Structure\n\n- A claim\n  - Supporting evidence\n- [ ] Check the assumptions\n\n> An observation is not yet an explanation.\n\n---\n\nContinue here.\n",
  ),
  "editor/tables": guide(
    [
      [
        "Create and edit a table",
        "Use /table or a Markdown pipe table. Click a cell to edit its contents, including inline formatting and mathematics. Tab navigates cells. Wide tables scroll within the document instead of widening the entire workspace.",
      ],
      [
        "Add rows and columns",
        "Move near the bottom or right table edge to reveal the add-row or add-column control. Hover over the top-right corner for alignment, TSV copy and more actions. Right-click a cell or use Shift+F10 for the same compact table menu.",
      ],
      [
        "Reorganize safely",
        "Use the Row, Column and Table menu sections to insert, remove and manipulate the relevant structure. Commands operate on the active cell or selection. Deleting a table is different from clearing a cell; inspect the selected operation before applying it.",
      ],
      [
        "Portable content",
        "Markdown tables are text, not spreadsheets. They do not execute formulas or maintain live links to imported datasets. A CSV excerpt is a frozen table with a source link.",
      ],
    ],
    "| Quantity | Meaning |\n| :--- | ---: |\n| $E$ | Energy |\n| $m$ | Mass |\n\n",
  ),
  "editor/code": guide(
    [
      [
        "Open a code block",
        "Type three backticks, optionally followed by a language, and press Enter. The editor pairs the closing fence and enters the code surface. Language suggestions are available both at the opener and in the block's language field.",
      ],
      [
        "Keep controls out of the way",
        "Hover or focus the block to reveal its language and contextual controls. A 2px theme-matched outline identifies the block without moving its contents. Copy the code without its fence; change wrapping and line numbers through block actions.",
      ],
      [
        "Delete an empty block",
        "When the rich input is empty, Backspace returns to the opening fence rather than trapping the cursor or leaving two empty fences. Ordinary typing and undo continue from that point.",
      ],
      [
        "Execution and completion",
        "Code is syntax-highlighted text, never executed. Code/snippet autocompletion is disabled; language-name autocomplete remains available. This is not a notebook runtime or an IDE.",
      ],
    ],
    fence("python", "def energy(mass, c):\n    return mass * c**2") + "\n\n",
  ),
  "editor/math": guide(
    [
      [
        "Inline and display equations",
        "Use `$...$` or `\\(...\\)` inline. Use `$$` delimiters on separate lines, or `\\[` and `\\]`, for display mathematics. Typing `$$` and Enter opens a paired rich equation block. Click the equation to edit its TeX; source and rendering stay together during editing.",
      ],
      [
        "Symbols and completion",
        "The equation input offers symbol/template completion. Math and chemistry rendering support the configured renderer and macro settings. Use Math Studio when you want a dedicated equation file and rendering exports.",
      ],
      [
        "Labels and assumptions",
        "Use labeled equations and equation-reference commands to link your argument. Keep assumptions in definition/theorem/proof/lemma callouts. Display equations can be nested inside quotations and properly indented footnote contents.",
      ],
      [
        "Editing feedback",
        "Hover identifies the block with an inset outline without opening its source. TeX errors keep the original input available. Empty-input Backspace returns to a single opening $$ fence. Rendering is not a symbolic algebra system: it does not verify the mathematics.",
      ],
    ],
    "Inline $E=mc^2$.\n\n$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n\n> [!theorem] A useful identity\n> State the assumptions before using the result.\n",
  ),
  "editor/definitions": guide(
    [
      [
        "Footnotes",
        "Insert a reference such as `[^method]` and define it with `[^method]:`. Press Enter after the definition opener to work in the dedicated titled footnote editor. Continuation paragraphs and display equations belong to the definition when indented. Hover over a rendered footnote reference for its contents.",
      ],
      [
        "Document metadata",
        "YAML frontmatter at the start of a document becomes a dedicated property table. Edit keys and values as table cells, without application-form backgrounds. Use the metadata command to insert it. Invalid or unsupported source remains available rather than being silently discarded.",
      ],
      [
        "Link definitions",
        "Write `[method][source]` with a separate `[source]: URL` definition. The rich definition block presents the identifier, destination and optional title as table-like fields. Links stay portable Markdown. Command/Ctrl-click follows a safe link without changing the editing selection.",
      ],
      [
        "Example",
        fence(
          "markdown",
          '---\ntitle: Experiment notes\nauthor: Ada\n---\n\nSee [the method][source] and the qualification[^a].\n\n[source]: https://example.org "Source title"\n\n[^a]: First paragraph.\n\n    A continuation paragraph.',
        ),
      ],
    ],
    '---\ntitle: Experiment notes\nauthor: Ada\n---\n\nSee [the method][source] and a qualification[^a].\n\n[source]: https://example.org "Source title"\n\n[^a]: An assumption worth recording.\n\n    Another paragraph in the same footnote.\n',
  ),
  "editor/media": guide([
    [
      "Review before insertion",
      "Use /image, /attachment, /pdf, /audio or /video. The picker has Library, Upload and URL tabs, search, filters, folders, multi-selection and explicit previews. Confirm Insert to change the note. Cancelling insertion does not delete successfully uploaded library files.",
    ],
    [
      "Paste, drop and upload",
      "Paste or drop files to upload and insert at the saved document position. Transfers supports progress, pause, cancellation and retry. Concurrent edits are tracked; a removed insertion position is not silently replaced by an unrelated cursor position.",
    ],
    [
      "Images and figures",
      "Click an image to edit its source above the still-rendered image. Double-click opens the dedicated viewer. Choose numbered figures for captions, labels, alignment and width; insert a Figure reference from its command. Right-click Figure & presentation changes the rich wrapper.",
    ],
    [
      "Stable references",
      "File codes remain stable across rename and move. UUIDs identify files; attachment links pin immutable versions. The action-only hover panel offers Open, Open beside and expandable identity details without loading a media preview. Explicitly inserted PDF/audio/video previews are different and remain supported.",
    ],
    [
      "Research excerpts and checks",
      "Insert saved PDF quotations with page/version provenance, timestamped media links, or frozen CSV/TSV excerpts. Copying a private annotation into shared text needs confirmation. Check document attachments reports inaccessible versions, newer versions and figure/alt-text problems; it does not silently rewrite links or probe external URLs.",
    ],
  ]),
  "editor/connections": guide(
    [
      [
        "Link related notes",
        "Use the Link a note command or `[[Note title]]`. Styled links distinguish note references from prose. Backlinks and the knowledge graph help trace connections. Command/Ctrl-click opens a link while ordinary editing clicks remain editable.",
      ],
      [
        "Cite sources",
        "Add sources in Reference library, then use the Citation command to insert the appropriate citation key. Keep the bibliography and linked source files together. A link to a paper is not a grant of access to that paper.",
      ],
      [
        "Draw a diagram",
        "Insert a Mermaid diagram through its command or a mermaid code fence. Edit its source using code-block controls. Double-click the rendered diagram for zoom and inspection. Invalid diagram source remains editable; a diagram is not executable application code.",
      ],
      [
        "Copy and export",
        "Source links and Markdown remain canonical. Check that recipients can access linked files, or explicitly export authorized assets when sharing a portable document.",
      ],
    ],
    fence(
      "mermaid",
      "flowchart LR\n  Question --> Evidence\n  Evidence --> Review",
    ) + "\n\n",
  ),
  "editor/navigation": guide([
    [
      "Outline and contents",
      "The outline follows heading hierarchy. A document TOC block is rendered navigation: clicking a section navigates rather than revealing its source. Search finds occurrences in the current note; use workspace search to find other files.",
    ],
    [
      "Minimap and block guides",
      "Enable the minimap and block-range/folding guides in Appearance. The minimap shows document structure, visible position and supported markers. Use Return to cursor after exploring. These overlays do not enter your Markdown or exports.",
    ],
    [
      "Bookmarks",
      "Add a reading bookmark, rename or remove it, and use its marker to return to the passage. Bookmarks are personal reading data, not edits to the shared document. Anchor changes can make a bookmark unresolved; review rather than guessing its location.",
    ],
    [
      "Annotations and discussions",
      "Use a block's margin actions to add an annotation card. Private-first notes and explicitly shared discussions have different audiences. Select text to comment when appropriate. Use the research side panel and its resizer without changing the document width preference.",
    ],
  ]),
  "editor/snippets": guide([
    [
      "Start with a method",
      "Choose a research template when creating a note or open /snippets. Templates are starting points; adapt the question, assumptions and protocol to your study.",
    ],
    [
      "Save reusable text",
      "Select Markdown and choose Save selection as snippet. Name and tag it, then keep it personal or save it to a workspace where you can edit. The library supports editing, duplication, archiving and restoring.",
    ],
    [
      "Independent copies",
      "Inserting a snippet creates an independent copy, not a synchronizing transclusion. Editing it in a note does not update the snippet. File-version references in snippets remain pinned and participate in version retention.",
    ],
  ]),
  "editor/review": guide([
    [
      "Collaborative writing",
      "Authorized collaborators edit the same Markdown document. Presence and peer selections help coordinate. Local save, synchronization and server confirmation are distinct states; recovery prompts retain work when access or connectivity changes.",
    ],
    [
      "Version history",
      "Open history to inspect snapshots, name milestones and compare rendered or source differences. Review a specific revision. Restore is a guarded change, not a reason to discard someone else's current work.",
    ],
    [
      "Suggestions and reviews",
      "Suggest mode records proposals for deliberate review. Accept or reject with current permissions, and refresh a stale comparison before applying changes. Assigned workspace reviews pin the reviewed snapshot, so subsequent edits do not change what was approved.",
    ],
    [
      "Frozen paper evidence and follow-up tasks",
      "Request review on a Markdown milestone can freeze its bibliography and exact figure versions. The reviewer needs existing access; full evidence loads only when expanded in the inbox. Library edits do not replace it. Follow-up task links a specific milestone or reference-history event to a same-workspace task without copying private text. Removed sources show as unavailable, not the newest version.",
    ],
    [
      "Scope of sharing",
      "Document edits, personal bookmarks, private annotation cards and shared discussion threads have different storage and access boundaries. Moving a note to a shared space is not equivalent to sharing an individual private annotation. Check the destination and audience.",
    ],
  ]),
  "editor/export": guide([
    [
      "Read without editing",
      "Read mode keeps document typography, equations, diagrams and navigation while removing editing controls. It does not change the underlying file permissions. A viewer role remains read-only in every mode.",
    ],
    [
      "Choose an export",
      "Export a styled HTML snapshot, Print / Save PDF, Markdown, Markdown with assets ZIP, or an editable LaTeX research project. Opening Export freezes current source, including unsaved edits; Refresh snapshot explicitly includes newer work. HTML/PDF are snapshots, not live collaborative views or embedded workspace players.",
    ],
    [
      "Editable LaTeX research projects",
      "Choose BibLaTeX/Biber or natbib/BibTeX, numbered or author–year citations, paper size, margins and optional authors/date. Review TeX, Reading, Bibliography, Files and Checks before preparing the ZIP. Reading is an HTML approximation, not a compiled PDF. Original Markdown, raw bibliography, code and authorized exact asset versions travel with local compile instructions. No server compiler, external upload or linked-note assembly runs. Review warnings and compile only trusted projects locally without shell escape.",
    ],
    [
      "What travels with a file",
      "Portable exports can include authorized fonts, equations, diagrams and selected assets. Ordinary private links may still require sign-in. Preview the output before sending it; source files and PDF metadata may contain information beyond the visible excerpt.",
    ],
  ]),
  "editor/shortcuts": guide([
    [
      "Your current bindings",
      "The catalogue below is generated from the same command definitions as the editor and respects your keyboard preferences. An unassigned command can still be found through command search or its relevant menu.",
    ],
    [
      "Context matters",
      "Slash commands insert blocks while writing. Table commands need a table/cell; image commands need an image; selection commands require an appropriate selection. Native system/browser shortcuts may reserve some combinations.",
    ],
    [
      "Customize",
      "Open Settings → Editor to change shortcuts and editing behavior. Resolve binding conflicts there. Shortcuts displayed here update with your saved preferences; they are not an independent hardcoded list.",
    ],
  ]),
  "research/workbench": guide([
    [
      "Choose your evidence context",
      "Open a workspace and choose Research between Overview and Files. Summary, Library, Reading queue, Evidence and Knowledge graph share that workspace’s content permissions. No second context selector is needed. Tabs retain filters and selection while you explore the workspace. Summary highlights reading progress, recent annotations and bookmarks.",
    ],
    [
      "Read deliberately",
      "Use Want to read, Reading, Read and Archived in your private reading queue. Open a paper at its saved position or open it beside current work. A PDF can be queued even when it is not yet a bibliography entry. Archived means removed from active reading, not deleted from storage.",
    ],
    [
      "Turn evidence into a draft",
      "Select up to 50 papers, references or PDF annotations and choose Create research note or Create Canvas. Review the exact generated scaffold and destination. These are deterministic copies with provenance, not AI-written conclusions. Add your interpretation after creation.",
    ],
    [
      "Respect the audience",
      "Copying private annotation text into a shared destination requires acknowledgement. File links retain their original permissions, and immutable version links do not silently follow new uploads. If evidence or access changes before confirmation, refresh the preview. Cancel writes nothing.",
    ],
  ]),
  "research/references": guide([
    [
      "Open the library",
      "Open Workspace → Research → Library. Each workspace owns an independent bibliography; your personal workspace is private and restricted workspaces retain their content permissions. Reading statuses and saved searches stay private. Use the sortable table and resizable details panel; filters and selections survive switching Research tabs within the same context.",
    ],
    [
      "Add and find references",
      "Add a reference manually or explicitly look up a DOI/arXiv identifier. BibTeX/RIS imports preview metadata, duplicate matches and key renames before writing (1,000 entries / 2 MB per import). Organize nested collections and tags, filter title/key/author/year/status, and save personal searches. Drag selected references onto collections, or use the bulk organization controls.",
    ],
    [
      "Connect and export",
      "Details links existing notes and standalone PDF versions from the same context and shows citation usage. Export filtered or selected entries as BibTeX/RIS. Move references to Library Trash and restore them; existing citations continue to resolve. Copying metadata/tags to a shared library requires audience confirmation and never copies files, annotations or reading history. Shared metadata requires group editor access.",
    ],
    [
      "Review duplicates safely",
      "Select 2–20 entries, choose the retained reference and review identity-match reasons, linked-source impact, each field/custom value and extra BibTeX fields. Refresh after changing decisions. Merge combines tags, collections and file associations; every old citation key and reference URL remains usable. Markdown is not rewritten. Each reader keeps their own latest status. If a source changes during review, refresh the preview.",
    ],
    [
      "Reference history",
      "Open Details → History for paged import, copy, reviewed lookup, edit and merge provenance. View source explicitly opens the original record for that event. Existing records receive an honest upgrade baseline, not invented earlier history. Follow-up task links an immutable event to workspace planning. History remains subject to current permissions and permanent deletion of its owning source.",
    ],
    [
      "Explore the knowledge graph",
      "Workspace → Research → Knowledge graph shows that workspace’s explicit note links, citations and reference/PDF associations. Search highlights sources; filter types, tags, collections or unconnected items. Click to inspect, double-click to open. Drag to pan/move nodes, Ctrl/⌘ + wheel to zoom, or use Fit/fullscreen/list view. Explore one/two-hop neighborhoods and export SVG/PNG/JSON. Views are bounded to 1,000 sources and 5,000 edges; narrow context if truncated. No AI-inferred edges are added.",
    ],
  ]),
  "research/pdf": guide([
    [
      "Read comfortably",
      "Use continuous, single or facing pages, zoom/fit, rotation, contents and exact text search. Reading position resumes for the pinned file version. The outline is a compact hierarchy, not a second document browser.",
    ],
    [
      "Select and annotate",
      "Selecting text opens a small contextual popup rather than forcing the annotation sidebar open. Highlights, underlines, strikeouts, area notes, ink, arrows and text boxes retain page coordinates and version provenance. Tags, bookmarks and annotation discussions help organize follow-up.",
    ],
    [
      "Review evidence",
      "Compare file versions, link an annotation to a task, and create guarded workspace copies with mapped annotations. Private annotations stay private unless explicitly shared or copied into shared text. Discussion drafts recover on the current device and still require submission.",
    ],
    [
      "Optional processing",
      "OCR and paper assistance require configured, permitted providers. Review outgoing context and OCR results before use. Office conversion and real provider/container acceptance depend on deployment.",
    ],
  ]),
  "canvas/basics": guide([
    [
      "Create and navigate",
      "Create a Canvas file from Explorer's new-file menu. Pan, zoom or fit the board without moving its cards. Add a text card with the toolbar/context menu; double-clicking blank canvas does not create a card.",
    ],
    [
      "Edit cards",
      "Double-click a text card to edit it. Switch the card between Write and Source using its small toolbar. Rename, tag, color or lock cards from their actions/properties. Smart height can fit content; manual sizing remains available.",
    ],
    [
      "Connect and arrange",
      "Drag between card connection points, including same-side connections, and label the relationship. Select several cards with the selection rectangle, group them, align or distribute them, and use undo for changes. Edges connect card identities rather than a fragile screen coordinate.",
    ],
    [
      "Temporary playground",
      "The board below uses the actual Canvas interaction surface with in-memory text cards and equations. Sharing, workspace files, uploads, external links and assistant requests are disabled. Leaving the article discards it.",
    ],
  ]),
  "canvas/evidence": guide([
    [
      "Reference real files",
      "File cards can show images, PDFs, equations, audio/video, document previews and nested Canvas content when supported and authorized. Opening a file follows normal workbench routes. A preview is not a copy or a permission grant.",
    ],
    [
      "Control presentation",
      "Use contain/cover and available page/display controls for the selected card. Smart auto-height is coordinated to avoid competing collaborator resize loops. Large boards render visible cards rather than keeping every heavy preview active.",
    ],
    [
      "Collaboration and portability",
      "Shared Canvas uses property-level collaborative transactions, text-card editing and guarded save/recovery behavior. Export the board or a selection using the available image/document options or portable JSON Canvas. Inspect warnings about unsupported/private evidence before sharing.",
    ],
  ]),
  "tools/math": guide([
    [
      "A dedicated equation file",
      "Create a Math file from the same menu as a Markdown note. Math Studio has source editing, completion, symbol/template browsing and a live preview. Save state and file history follow the workbench.",
    ],
    [
      "Export the rendering",
      "Use preview actions to copy or download supported SVG and raster formats, including JPEG. Adjust the foreground, background, transparency and size for the destination. Raster output is not editable TeX; retain the source when handing off research.",
    ],
  ]),
  "tools/image": guide([
    [
      "Edit an image",
      "Image Studio supports layered raster/text work, crop and resize, transformations, masks and blending within its size budget. Review the crop or canvas-size operation before applying it. Cloud drafts and recovery heads protect ongoing work; original uploaded file versions remain separate.",
    ],
    [
      "Inspect without editing",
      "Double-click an image or Mermaid diagram in a note to open the visual viewer. Zoom, fit, fullscreen and supported metadata/EXIF inspection help examine details. The explicit viewer is separate from attachment hover actions, which do not preview content.",
    ],
    [
      "Export and limits",
      "Choose a supported export format and inspect transparency, dimensions and color. Imported formats and large layers have limits. Profile image upload offers a crop step before saving the account picture.",
    ],
  ]),
  "tools/viewers": guide([
    [
      "Open the file, not a tool",
      "Text, equation, Canvas and image projects open through the same file routes as notes. Use Explorer to create a raw-text, JSON/YAML/CSV or Office template where supported. The active view follows the file type.",
    ],
    [
      "Text and media",
      "Text Studio is for source/plain text. Audio and video viewers expose supported playback controls; browser codecs determine which files play. Dataset excerpts are frozen snapshots, not executing spreadsheets.",
    ],
    [
      "Office documents",
      "Word, spreadsheet and presentation viewers are read-only. They provide document outlines, styled worksheet grids or speaker notes when available. Optional private conversion needs deployment configuration; it is not a cloud Office editing suite.",
    ],
  ]),
  "workspace/files": guide([
    [
      "Browse and organize",
      "Explorer offers list/grid layouts, search, sorting, folder navigation, right-click blank-space creation, multi-selection and drag/move/copy workflows. Click blank space to clear selection. Permission and destination checks remain authoritative.",
    ],
    [
      "Import editable notes and collections",
      "In Files or Explorer, open Add files and choose Import Markdown, Import folder or Import ZIP. Review the destination, audience, hierarchy and local Preview/Source before confirming. Markdown becomes editable collaborative notes; other files stay attachments. Local relative links between included notes and files are rewritten to their new identities without reformatting the source. Keep both, Merge folders or Skip matching never overwrite existing contents. Raw Upload files/folder remains separate. Search & commands and folder context menus open the same importer.",
    ],
    [
      "Recover an interrupted import",
      "Activity & recovery retains private import preparation for seven days. Pause, resume or reselect the same original collection; accepted checksummed parts are reused. Nothing appears in the shared workspace until the whole collection publishes atomically. If the destination, quota or access changed, review the new plan explicitly. Only the author can discard their preparation, even after losing destination access. Canceling an already published import never deletes its files. Folder pickers cannot report empty directories; ZIP and dropped folders retain known empty directories. Import requires connectivity and the workspace worker.",
    ],
    [
      "Inspect identity",
      "The details panel shows file identity, location, versions and supported previews. Human-readable reference codes survive renames and moves; UUIDs remain canonical. Deleting the current file returns navigation to its parent instead of leaving an unusable file URL.",
    ],
    [
      "Audit and Trash",
      "Quick access exposes Audit and Trash. Audit records authorized changes and operation progress. Trash separates Ready items from Needs attention. For a stored file, Remove protection & purge is available directly in its Trash menu and deletion preview. One confirmation can remove your reading data, release attachment retention from notes/history you manage and edit, detach editable library file associations and delete the file. Notes, revisions and library references remain; you must acknowledge broken attachment links. The action is atomic and rejects changed protection or access. Other readers' records, inaccessible sources, annotations and formal research evidence remain protected. Review protection offers selective reading cleanup and links to sources instead. Restore file keeps the evidence and its links. Recheck examines saved server edits, not unsynchronized device changes. Ordinary cleanup only deletes ready items.",
    ],
  ]),
  "workspace/groups": guide([
    [
      "Groups and workspaces",
      "Groups organize membership and shared administration. Workspaces organize files, plans, discussions and reviews. Create or join a group through Groups, then use invitations and appropriate roles rather than sharing credentials.",
    ],
    [
      "Permissions",
      "Viewer, commenter and editor capabilities differ from management authority. Group library editing and workspace editing are checked separately. Personal work stays private unless you deliberately copy, move or share it.",
    ],
    [
      "Manage the workspace",
      "Workspace settings include general information, people, storage, integrations, activity and lifecycle controls. Group administration is available through its page/settings integration. Revoking access can leave unsynchronized local recovery data for the original author; it does not authorize further server writes.",
    ],
  ]),
  "workspace/planning": guide([
    [
      "Research properties",
      "Workspace Settings → Planning → Task fields defines text, number/unit, date, checkbox, URL, choice and person properties. Review Experiment or Paper review presets before creating fields. Archive used choices/fields instead of deleting their identities. The planning Properties action adds filters, selected List/Gantt columns and sorting to saved views. Summary/CSV previews explicitly shorten long values; the task opens the complete property.",
    ],
    [
      "Record actual work",
      "Planning → Time, or a saved task’s Time panel, records manual work without changing dates, estimates or progress. Your entries can be corrected, withdrawn and restored with full history; management corrections to another person’s entry require a reason. Filter member/task/date, choose descendant rollup explicitly and export CSV. Task drafts survive Properties/Time switches. Logs are workspace-shared, not an inferred billing timesheet.",
    ],
    [
      "Reviewed automations",
      "Workspace Settings → Planning → Automations prepares metadata-only proposals from task events, a daily local schedule or Run now. Rules start paused and never apply themselves. In the shared Review queue, select tasks, preview and explicitly Apply; changed versions/configuration/access block the whole batch. Cancel leaves tasks alone, and Undo refuses intervening edits. No provider, script, body/date/dependency edits or automatic time creation. Stage 3 database/browser/concurrency/scale acceptance remains pending; consult docs/PLANNING_LAB.md before deploying it.",
    ],
    [
      "Plan beside your files",
      "Workspace Planning offers List, Board, Calendar, Gantt and Workload. Add tasks, owners, estimates, dates, dependencies and milestones; link evidence instead of copying private content into every task.",
    ],
    [
      "Review schedule changes",
      "Use immutable baselines to compare plans. Critical-path/slack overlays are working-day calculations, not forecasts. Preview dependency-aware scheduling before applying it, with revision-checked Undo.",
    ],
    [
      "Track outcomes and browse history",
      "Planning → Goals searches saved outcomes/descriptions and pages through Active, Archived or All goals. Filters includes tracking type, My goals and creation order. Opening a goal loads its full Markdown; the original version protects your draft from peer overwrites. The workspace limit remains 200 including archives. History searches all retained metadata summaries. Routine history separates Changes from Generated tasks; date/status/deleted-task filters live in a compact dialog, and deleted occurrences open the Deleted tasks view.",
    ],
    [
      "Review research requests",
      "Planning → Intake keeps open requests and decision history in one workspace. Search request contents and review notes, choose a status/type or My requests, and page through older submissions. Opening a request loads its full Markdown; peer changes retain your draft but block stale resubmission or decisions. Acceptance creates one linked task, even on retry.",
    ],
    [
      "Coordinate the group",
      "Group portfolios summarize accessible workspace plans and weekly estimated effort against explicit availability. Unknown capacity is not zero. Reviewed capacity previews include accessible active group workspaces and retain cohort revision fences; inspect group capacity for combined commitments.",
    ],
  ]),
  "workspace/websites": guide([
    [
      "Prepare a publication",
      "Workspace → Website creates a personal or team research site. Select content and assets, arrange sections and choose a layout/theme. Private drafts are not the live website.",
    ],
    [
      "Review and publish",
      "Editors prepare a frozen release preview; managers approve publication. Later private edits do not modify the approved release. Readers can use topics, hierarchical contents, reading statistics and timeline archives. Syntax highlighting stays with exported code.",
    ],
    [
      "Domains and analytics",
      "Use the built-in site address, a portable static ZIP or a verified custom domain on a configured deployment. Private author analytics and optional tracking require deliberate configuration; publication does not automatically enable tracking. Publishing a complete PDF can expose its metadata and pages beyond an excerpt.",
    ],
  ]),
  "workspace/assistant": guide([
    [
      "Choose the context",
      "The assistant is opt-in and needs an approved provider. Select accessible notes, excerpts, Canvas cards or planning snapshots. Review the exact outgoing context before sending; selecting a workspace is not permission to send all its contents.",
    ],
    [
      "Review every batch",
      "Additional discovery happens locally. Each later outgoing batch waits for fresh approval: inspect its complete messages, exclude or narrow new excerpts, then update the preview before consenting. Set the run's round/output caps up front. Missing usage and monetary costs remain unknown, never zero. Source chips check access and show the exact captured snapshot; citation membership does not establish correctness.",
    ],
    [
      "Review proposals",
      "Answers can cite selected evidence. Changes to documents, tasks or schedules use explicit reviewed proposals and guarded application/Undo. Model output is not authoritative research evidence, and stale proposals may require a fresh preview.",
    ],
    [
      "Recover known outcomes",
      "Finish saved response repeats local processing only, without contacting the provider. Review remaining changes prepares eligible unfinished work in a separate draft, preserving completed receipts and stale-version guards. Uncertain or cancelled requests are never automatically replayed; inspect their actual outcome first.",
    ],
    [
      "Provider boundary",
      "Data sent to an external provider leaves this workspace's server boundary. Configure keys and provider permissions through the appropriate settings. Documentation playgrounds and deterministic Research synthesis do not call a model.",
    ],
  ]),
  "workspace/offline": guide([
    [
      "Prepare before disconnecting",
      "Install the PWA where supported and pin/select the work you need for offline access. Previously loaded assets may be available, but offline support is not a guarantee that every viewer or file has been downloaded.",
    ],
    [
      "Read the save state",
      "Local saves, queued changes, synchronization and server confirmation are distinct. Reconnect to reconcile pending work. Access changes or revision conflicts require review; do not discard recovery data to silence an error.",
    ],
    [
      "Privacy and backup",
      "Transport security depends on correct HTTPS/WebSocket deployment. Axiom is not end-to-end encrypted: the server processes authorized content. Device caches and provider requests have separate privacy boundaries. Keep server database and stored-file backups together.",
    ],
  ]),
  "workspace/mcp": guide([
    [
      "Connect deliberately",
      "MCP and integrations let external clients use approved workspace capabilities. Grant only needed scopes and workspaces; review and revoke connections in Settings when no longer needed.",
    ],
    [
      "Read versus change",
      "Read access is not write or management authority. Mutations follow the app's permissions and reviewed-action workflows where required. An external model cannot bypass a revoked grant or hidden resource by knowing an identifier.",
    ],
    [
      "Scoped evidence reads",
      "workspace_evidence_search returns bounded literal search previews; workspace_evidence_read captures exact native text or nonrecursive Canvas cards with source identity. Both use the existing workspace-read grant and recheck access. A search summary is not citable evidence, and neither tool can approve a model batch or its own changes.",
    ],
    [
      "Before using an agent",
      "Understand which client receives your data, the credentials it stores and the actions you approve. Prefer narrow scopes and inspect the resulting Audit/history entries. Documentation examples do not create connections or issue credentials.",
    ],
  ]),
  "preferences/appearance": guide([
    [
      "Color, components and type",
      "Appearance separates light/dark palettes, document packs and eight original interface systems: Axiom, Contour, Vector, Folio, Harbor, Signal, Gridwork and Cutline. Compare their real controls with the same colors and fonts. Configure interface, reading and code typography independently; the live scratchpad retains your sample.",
    ],
    [
      "Reading geometry",
      "Tune line height, reading width and document decorations. Minimap, range guides, folding and other navigation overlays are optional. The workspace sidebar and research context panel can be resized directly with their horizontal handles.",
    ],
    [
      "Behavior and accessibility",
      "Editor settings control shortcuts and supported typing behavior. Respect reduced motion, visible keyboard focus and high contrast. Account preferences and device overrides have different scopes; check which you are editing before expecting another device to match.",
    ],
  ]),
};
