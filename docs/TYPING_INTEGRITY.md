# Markdown typing integrity

The current desktop vNext editor keeps active paragraph/heading text and list/quote **body contents** as literal Markdown, with complete images remaining rendered. Whitespace-completed list and quote markers remain rendered chrome, never duplicated in focused body text. Headings retain H1–H6 typography with editable `#` markers. Leaving hides inline syntax; returning reveals the original body without changing typography. Hover and secondary clicks never activate prose editing. Code, mathematics, tables and metadata retain specialized surfaces; dividers and TOC remain static. The native rollback engine retains its earlier behavior and is not the production default. This is not a claim of complete Typora parity.

## Interaction contract

- Lists render on `- `, `* `, `+ `, a number followed by `. ` or `) `, and complete task markers.
  Bare markers remain plain text outside list wrappers until their space arrives.
  Command/Ctrl+Enter (also Shift+Enter) inserts a hard break within the same item;
  ordinary Enter creates a sibling. A second Enter on the empty sibling exits one
  actual nesting level, independently of indentation preferences. Tab/Shift+Tab
  preserve quoted/footnote prefixes; indenting an ordered item starts its nested
  sequence at 1. Hidden-marker caret positions snap to the body in Write mode.
  The authoring dialect recognizes empty nested markers before setext underlines;
  CommonMark/GFM parsing is unchanged.
- Enter advances vertically through a table, creating a row at its end if enabled.
  Enter on a wholly empty final body row removes that row and continues outside;
  populated rows are never discarded to exit. Mod+Enter retains its table-row
  shortcut. Quotes/callouts and footnotes use empty-line exits one container at a time.
- Shared block-boundary commands insert or reuse parent-level separators, including
  quoted blank lines. Leaving `> 1\n> 2\n> ` produces `> 1\n> 2\n\n` before
  subsequent typing. Imported lazy continuations remain valid Markdown.
- Backspace on an already-empty visual block removes its structure in one local
  undo step. Deleting the last character first leaves an editable empty block;
  the next Backspace removes it. Populated parents/siblings survive. A table is
  removable this way only when all cells are empty; images, dividers and TOCs are
  meaningful atoms, not zero-length bodies. Code/math Enter remains literal;
  Mod+Enter exits them inside the correct parent container.
- Appearance → General controls view-only block guides. They have no source
  spans, selection targets or exported content. Toggling cannot write Y.Text or
  change document geometry. Metadata uses a flat, theme-token property table.
- Monaco-style fold chevrons are outside the editable DOM. A collapsed scope is a
  view-only atomic projection with the full canonical Markdown span, not deleted
  or separately serialized content. Nested fold state survives parent toggles;
  peer edits rebase it, replaced opening identities retire it, and explicit
  navigation reveals enclosing scopes. Folding adds no Y.Text updates or undo
  entries and cannot change another collaborator's view. Code/math, list groups,
  quotes/callouts, tables, metadata and footnotes are eligible when multiline.
  Structural preview boundaries resolve to valid rich text/node selections, even
  when the only or final block is folded; canonical source offsets stay separate.
- Math previews distinguish source positions from typesetting input. Moving an
  unchanged equation never recreates its rendered subtree; changed TeX retains
  the last preview while the worker runs. Outdated worker results cannot paint a
  node carrying a newer request. Source code/math editing surfaces keep their DOM.
- `[TOC]` is a static, keyboard-accessible heading navigator. Left/right click never
  reveals its token. Selecting its non-link area allows normal deletion/undo.
  Frontmatter is a metadata table: editable scalar keys/values, quiet add-property
  control, grouped context actions and Enter navigation. Structured YAML is shown
  read-only in its value cell; use Source for nested structures. Field commits
  rebase and compare their original ranges; conflicts retain a recoverable draft.

- In vNext Write, `[^id]:` remains an editable opener until Enter creates a titled
  rich footnote. The body is part of the main ProseMirror projection, with child
  source spans lifted through the hidden marker and continuation prefixes. There
  is no nested editor, serializer, history or Y.Text. Only active body prose
  reveals its usual syntax; math/code/tables retain specialized editing surfaces.
  Title/ref navigation focuses the body; hidden source-marker caret positions
  map to the body on entering Write, without a source edit. Backspace on an empty
  first body position removes the definition, with author-local undo/redo. It never
  joins a populated definition to preceding prose. Tab/Shift-Tab cannot consume
  the footnote's indentation. `tests/footnote-rich.test.ts` verifies projection,
  literal/command ranges, table growth and equation indexing;
  `tests/editor-lab/footnote-rich.spec.ts` covers the rich interactions, clipboard
  event adapters, Chromium CDP composition, peer changes and permissions.
- Footnote Enter/Shift-Enter runs the normal structural command on a mapped
  definition body, then adds only the required continuation prefixes to inserted
  lines. Definitions are separate from ordinary AST blocks, so Source mode must
  explicitly opt into this path too. Empty nested list/quote items stay in the
  footnote; a final empty continuation exits it. The source marker and untouched
  body are never reserialized. Wrapped prose may omit indentation until a blank
  separator or new block; new paragraphs/equations retain four-column indentation.
  Keyboard continuation, caret/undo/peer behavior, LF/CRLF, equations and rollback
  Source mode are exercised in `tests/editor-lab/footnotes.spec.ts`; parser,
  container-boundary and source-mapping cases are in `tests/footnote-editing.test.ts`.
- Hover, right-click and macOS Control-click on non-link content do not activate
  prose or move the source/DOM typing caret. Menus bookmark the inspected target
  separately; Escape returns to the original relative caret. Commands revalidate
  block identity and reject overlapping peer replacements instead of acting on
  stale offsets. Modifier-link navigation retains its separate behavior.
- Complete images remain rendered until deliberate source activation. Left-click
  or Enter/Space on a selected image reveals its Markdown as ordinary main-editor
  text, with a non-editable preview decoration below the containing paragraph/cell.
  This includes quotes, lists and rich footnotes. Other images stay rendered.
  Typing is shared immediately; normal Enter, clipboard and author-local history
  apply. Leaving the paragraph collapses valid source; Escape keeps edits and
  selects the image for deletion/arrow exit. Empty source removes the preview.
  Incomplete source is live Markdown, not a private buffered field. A local last
  valid preview survives while editing, visibly labeled; leaving invalid source
  retains the literal text, never an obsolete image. Preview decorations add no
  source positions, copied text, word counts, history or shared rich state.
  Actual Yjs deltas rebase reveal ranges and invalidate replaced/deleted peer
  identities, including same-text replacements. Existing composition recovery
  and permission guards apply. Same-address updates reuse loaded elements; changed
  URLs use debounced, stale-result-guarded requests and retain the previous image
  during loading. Unsafe URLs and disabled previews never display an old image
  as current. Image-detail dialogs remain explicit field edits.
- Empty Enter exits one quote depth. After child prose, retain a parent-depth
  blank separator before the new body so CommonMark lazy continuation cannot
  capture the next keystroke in the child. Repeated exits, quotes in list items,
  pasted lines, LF/CRLF and relative peer rebasing use the same source transaction.
- Code-body autocomplete and snippet expansion are disabled, including the
  Ctrl+Space trigger. Tab/Shift+Tab indent/outdent; Enter inserts a newline.
  Math snippet fields never intercept code indentation. Language-name and math
  completion remain enabled. Empty-block Backspace removes both fences instead
  of restoring an opener; ordinary code editing retains prefixes and collaboration carets.
- Code-language suggestions are optional on opening fences. Typing three backticks
  or tildes shows the same alias-aware catalog used by the code block's language
  combobox. Tab completes; arrows select and Enter accepts; Escape dismisses.
  With no explicit selection, Enter keeps normal block creation, even for a bare
  fence. Only the info string is replaced. The field commits once, restores its
  body caret, permits custom names and guards live peer/permission changes.
- Slash image/attachment pickers bookmark their query without selecting or deleting it. Cancellation preserves the live caret, so immediate typing appends normally. The workspace must not replace the engine's relative bookmark with the visible selection. Insertion replaces the query in one author-local undo step; overlapping peer edits are rejected.
- Modifier-click navigation is a pointer action, not an editing selection. Resolve rendered or literal links before prose reveal; open on release only once. Preserve WebKit's pre-context-menu DOM range, keep actual right-click editing menus, and block unsafe destinations.
- Inline syntax in the active prose unit is ordinary editable text, including `# `, strong/emphasis/link delimiters, entities and escapes. Completed list/task and quote prefixes are hidden using per-line source ranges, not deleted. A quiet heading-prefix tint uses the same font size and line height. Other list items and quote paragraphs remain rendered; nested lists and specialized blocks are not flattened. Merely focusing, leaving or returning never changes shared Markdown.
- `>` followed by space/tab immediately exposes a mapped empty quote body. Bare/unspaced markers remain literal while active, including pending nested markers. Body-start Backspace unwraps one quote level of the active paragraph; at subsequent visual line boundaries it joins lines and removes the intervening hidden prefix. Lazy inner continuations never lose an outer quote marker. Enter continues the quote and empty Enter exits one level. Multiline body typing/paste/composition expands explicit prefixes and the existing newline convention once. Explicit source-mode carets inside hidden prefixes reveal the exact source unit instead of snapping to the body.
- Active headings use semantic H1–H6 elements and the same personal heading font, weight, scale and spacing as resting headings. Removing the heading marker restores paragraph typography; undo restores it. Non-heading text such as `#hashtag` remains a paragraph. Setext headings retain their authored underline instead of acquiring generated hashes. These are view-only attributes, not stored source or a preference change.
- Typing never commits a block by moving the caret to a different source position. A fence header stays editable until Enter. Its newly paired body is inserted before following content, even when another fenced block follows. Enter on an existing closed fence header moves into its existing body.
- Tables remain grids, with caret-local inline syntax inside cells. Missing cells have a distinct focus target even when they share a source offset with row padding. Typed escaped pipes do not gain a second backslash. Cell-specific escaping and line-break conversion apply only to a selection contained in that cell, never to whole-document replacement.
- Code remains highlighted and display equations keep editable TeX with a preview. Clicking a nested equation enters its actual TeX body, not a hidden container prefix. Compact hover/focus controls preserve the embedded caret when opening and dismissing a menu.
- Table chrome never enters the editable DOM or shared source. Edge append targets the hovered table, focuses its new cell and forms an author-local undo step. Icon panels retain Yjs-relative row boundary identities; disjoint/cell-text edits rebase, but structural replacement or movement invalidates the target. Composition/read-only/size/header/final-column guards are rechecked at activation. LF/CRLF, mixed physical endings, container prefixes and a missing final newline survive row/column moves and grid expansion. Menus/details restore relative carets and reject stale field ranges before opening.
- Complete line-start `$$` display fences interrupt prose in STEM mode, including inside nested quotes, callouts and quoted lists, without blank separators. Incomplete fences, code and closing fences from a different container remain literal. Typed fences, slash insertion, Mod-Alt-B and the prose context menu keep quote/list prefixes. Mod-Enter continues at the same depth; empty Enter exits one quote level. Multiline TeX, labels and snippet fields preserve container prefixes and LF/CRLF. One-line equations expand only when an authored multiline edit requires it. Cross-container insertion selections are left unchanged with an explanation.
- Enter starts a new paragraph; Shift-Enter inserts a Markdown hard break within prose. Each extra blank paragraph has its own visible mapped insertion point, including at EOF. Heading Enter/Shift-Enter leaves the single-line heading. Lists/tasks continue on Enter; empty items exit/outdent. Quotes continue the active paragraph and an empty quote exits one level. Newlines preserve the surrounding LF/CRLF convention without rewriting existing mixed endings. A pipe header followed by Enter creates a table and focuses its first body cell.
- Backspace/Delete inside visible source deletes literal characters, including markers, without silently unwrapping the whole construct. At actual block boundaries the existing structural join/outdent rules remain. Empty paragraphs delete one adjacent whitespace gap at a time and undo restores it. Code/math boundaries and cross-block selections retain their existing fence/grid protections. Table edges navigate without deleting rows. All changes remain author-local undo steps.
- The left Notion-style block handle and drop indicator are removed. Right-click/Shift-F10, keyboard block movement and specialized table/code/math controls remain. Owned menus and fields keep the active prose source visible and restore the caret on dismissal.
- At the document start, `---` followed by Enter creates paired passive metadata. Enter on an existing metadata header moves into its body. Dividers elsewhere and `[toc]` commit on Enter. Callout titles and link definitions remain source-editable; footnotes use rich bodies in vNext Write and remain literal in Source.
- Automatic pairing respects the existing preference. Only a closer generated by this view and still owned by it can be skipped or deleted as a pair. Imported closers, undo-restored characters and competing edits are not silently consumed.

## Engine boundaries

`packages/editor/src/prose-projection.ts` supplies vNext's source-prose/blank-paragraph presentation nodes. `projection.ts` maps them to the ephemeral schema; `line-endings.ts` maps line-oriented edits back to the original text. The native projection is reused only for uncommitted fence masking. The CommonMark/GFM/STEM parser still supplies the canonical AST for commands, export, outline, diagnostics and statistics. These view nodes never mutate that AST or introduce another stored document format.

Active heading projections retain their parsed level. The `source_prose` schema
uses it to select a semantic heading tag and preserves that view node's kind
during browser DOM reconciliation. CSS keeps paragraph-only font resets away
from heading tags; markers inherit the heading font rather than a separate UI font.

Raw text uses identity UTF-16 source maps. Decoded reading text has a separate mapping path. Selection restoration requires an exact source target; a missing mapping reveals the affected source surface instead of snapping into another block. Paragraph-end ranges do not include browser-inserted paragraph breaks.

Mouse selection freezes DOM reconciliation until release. The editor captures the actual browser selection before redrawing, even if `selectionchange` has not arrived yet. A delta ledger maps that older DOM through intervening Yjs changes; it cannot replace the caret with a pre-click or pre-peer-edit offset. IME retains browser ownership until composition completes, with relative-position recovery for concurrent changes. A committed selection replacement includes unchanged leading/trailing characters so the caret stays after the complete inserted text. Menus preserve their existing target/recovery guards and reposition on viewport changes without losing focus.

`pairs.ts` records only local generated pairs, reanchors them through Yjs and cancels ownership after conflicts or deletion. All changes still use the existing `Y.Text("markdown")`, shared authorization, offline outbox, durable acknowledgement and author-local undo. The source-while-editing core adds no dependency or document-format migration.

The paper-style refinements add an optional font (appearance v3) and persistent
LaTeX ornaments (v4), not a Markdown or collaboration migration. `table-target.ts` owns temporary
source-relative structural targets. `editor-popover.ts` shares overlay ownership
with workspace context menus; toolbar/tooltip changes and local column resizing
must create zero Y.Text updates. Typography presets and color previews remain
personal and do not change editor history.

`quote-prose.ts` describes physical line prefixes/body ranges for projection,
multiline source edits and boundary deletion. `bridge.ts` uses the same expansion
for browser/IME replacements. Structural quote unwrapping has a separate undo
boundary per level. Decorative heading labels live in CSS with an
empty spoken alternative; the canonical section index supplies ephemeral node
decorations, not mapped editor text. Canonical heading IDs, source,
selection, copied text and outline labels therefore do not gain section signs.

Save confirmation waits for acknowledged updates and a durable server checkpoint. Access epochs are sealed into collaboration tokens and checked under the workspace lock. An archive/trash cycle cannot silently replay an old cache after restoration: its journal is retained, readable drafts are separately stored, and the shared note opens from a fresh journal. Multiple recoveries are selectable and downloadable; another tab cannot overwrite a retained draft. Device-storage failures remain explicit and do not fabricate local durability.

Embedded code/TeX source maps refresh after every reconciled projection, including
when the rich engine reuses an unchanged node. Peer insertions above a block move
its source offsets even if its visible text does not change. CodeMirror insertions
and snippet fields use one prefix/newline expansion map instead of repeated scans.
Quote-local blank paragraphs are view-only insertion points, not a second AST.

## Verification

`tests/footnotes.test.ts` verifies escaped reference metadata, safe definition-only
fragments, per-document keys, numbering/math context and image restrictions.
`tests/editor-lab/footnotes.spec.ts` covers delayed hover, pointer transfer, long
scrolling content, keyboard focus/Enter/Escape, description cleanup, passive
secondary clicks, peer changes, clipped anchors, mode/read-only behavior and the
native rollback editor. Its isolated React fixture mounts the actual reading
component in separate panes with identical keys, then updates/unmounts them.
Hover and scrolling assert unchanged source, actual DOM caret and history.
The live settings scratchpad adds local MathJax SVG and light/dark captures,
without saving account preferences or changing existing research notes.

`tests/tex-delimiters.test.ts` verifies TeX-style math before Markdown escapes,
container-local closing fences, literal code/backslash exceptions, labels, source
maps, unchanged CommonMark/GFM, incremental parsing and bounded unmatched lookahead.
`tests/generated-fences.test.ts` includes bracket-opener ownership and peer rebasing.
`tests/editor-lab/tex-tasks.spec.ts` checks per-key typing with automatic pairing,
rich math entry/deletion/re-entry, multiline LF/CRLF editing and shared undo.
Checkbox activation is independent of prose selection: pointer and keyboard
Space do not reveal source; the old caret or range remains unchanged, including
initially unfocused documents. Tests cover nested/numbered tasks, read-only
controls, peer prefixes and same-text marker replacement during a held press.
The live scratchpad also verifies real MathJax SVGs and unchanged delimiter source.

`tests/image-source.test.ts` checks mapped in-document image source, LF/CRLF
container prefixes, relative activation ranges and peer replacement identity.
`tests/editor-lab/image-source.spec.ts` checks ordinary prose above a retained
preview, immediately shared edits, incomplete source, deletion/undo, quoted CRLF,
table cells, rich footnotes, clipboard output without duplicate previews, peer
rebasing/replacement, permission changes, source-mode caret preservation and
keyboard activation in all three browsers. A Chromium CDP composition check
includes a concurrent peer edit; physical IME/system clipboard acceptance remains
separate. Loaded, pending and failed image states survive activation/collapse;
changed destinations are debounced without delaying source edits.
`tests/editor-lab/image-appearance.spec.ts` checks inherited prose typography,
long-address wrapping, preview order/containment and unchanged shared source with
Paper, Night and enlarged-text desktop appearances, and captures synthetic figures.

`tests/rendered-blocks.test.ts` verifies image atoms in active source/quoted prose,
multiline image spans, incomplete/code exceptions, nested quote separators and
mixed quote/list prefixes with LF/CRLF. `tests/editor-lab/rendered-blocks.spec.ts`
adds actual load/error/retry and delayed-image requests, stable loaded elements,
image selection/deletion/details/read-only state, passive hover/right-click,
macOS Control-click, context target conflicts and table-menu caret restoration.
Both canonical peers and actual DOM carets are checked for quote exits, parent
typing/paste, repeated exits and undo/redo. Images use controlled SVG routes in
the disposable laboratory, not external research files or shared notes.

`tests/quote-prose.test.ts` verifies literal triggers, nested/empty/lazy body maps,
CRLF, safe unwrapping and composition replacement. Browser quote checks cover
per-key DOM carets, immediate empty containers, paste, peer rebasing, author-local
undo, permission changes and CDP composition. Decoration checks cover all heading
levels, hierarchical numbering, peer level changes, block movement, accessible
names, source preservation, active/resting rules and dividers. The shared
`section-numbers.test.ts` covers skipped/start levels, duplicate IDs, nested/setext
headings, exact conformance HTML and whole-document numbering in rendered fragments.
`tests/editor-lab/dividers.spec.ts` checks rendered click/focus behavior, direct
Backspace/Delete, exact CRLF undo, peer rebasing, permission guards and Source/Write
switching. Divider selections never become active source prose or embedded fields.
`tests/block-boundaries.test.ts` covers marker gating, scoped separators, empty
deletion and imported lazy-continuation preservation. `tests/editor-lab/block-boundaries.spec.ts`
checks actual per-key typing, parent ownership, undo and guide geometry/state.
`tests/editor-lab/empty-blocks.spec.ts` and `generated-fences.spec.ts` cover empty
code/TeX removal, selected bodies, owned inline pairs, whitespace, quoted CRLF,
automatic/authored language labels, following-block protection and remote undo.
Deleting the final character and removing an already-empty block are separate
actions; no source reveal occurs just because the body reaches zero. Imported and
peer-edited delimiters survive body edits but can be deliberately removed once the
entire block is empty. The obsolete generated-fence-collapse tracking is no longer
used by vNext. `editor-vnext.test.ts` checks pre-history selection bookmarks,
replacements and peer rebasing. Read-only Backspace must not navigate away in WebKit.
`tests/code-languages.test.ts` covers the safe catalog, alias ranking and opening-
fence-only source ranges. `tests/editor-lab/languages.spec.ts` covers both menus,
keyboard/pointer acceptance, unselected Enter, dismissal, aliases/custom names,
quoted/list CRLF fences, peer rebasing/recovery, composition-event guards and
viewport/focus behavior across Chromium, Firefox and WebKit. These synthetic
composition checks are not physical OS IME acceptance.
`tests/editor-lab/code-completion.spec.ts` checks that code suggestions and snippet
expansion stay disabled in Write/Source and read-only surfaces, including
Ctrl+Space. It also checks normal indentation/newlines, quoted CRLF source, peer
caret rebasing, empty-block deletion and retained language/math completion.
The unconnected experimental `code-completions.ts` helper and its unit tests are
retained, but neither editor imports it or runs it while typing.
`tests/e2e/editor-decorations.spec.ts` covers persistent settings, customized fonts,
personal offline HTML, durable quote collaboration, v3 rejection and pending-v3
LaTeX outbox migration. Physical OS acceptance remains separate.

`tests/table-target.test.ts` and `tests/table-endings.test.ts` cover target identity
and source fidelity. `tests/editor-lab/{tables,table-contracts}.spec.ts` covers
edge append, immediate typing, keyboard/tooltips, header/permission guards,
nested/EOF tables, resize/scroll, peer rebasing, stale link fields, focus release,
composition guards and code/math menu carets across desktop browser engines.
`tests/e2e/editor-paper.spec.ts` adds durable collaboration/undo/reload, optional
style/palette persistence, Write/Read metrics, offline-font HTML, legacy-writer
rejection and pending-v2-outbox migration. Synthetic composition is not OS IME acceptance.

`tests/prose-projection.test.ts` covers all six active heading levels, nested
containers, exact source/outline maps, Setext and non-heading hash text.
`tests/editor-lab/headings.spec.ts` verifies typography tokens, literal hashes,
per-key DOM/source carets, departure/return, deletion/undo and peer heading-level
changes in Chromium, Firefox and WebKit. `tests/e2e/editor-vnext.spec.ts` adds
persisted heading edits, peer rebasing, local undo, reload and clean Read output.

`tests/editor-lab/media-links.spec.ts` covers host handoff without source or caret
changes, source/rendered links, read-only access and both editor engines.
`tests/e2e/editor-media-links.spec.ts` checks actual Explorer uploads, cancellation
followed by typing, CRDT bookmarks/conflicts, undo, reload and safe navigation.

`tests/quoted-equations.test.ts` checks quoted math grammar, source commands and
projection maps. `tests/editor-lab/quoted-equations.spec.ts` checks typing, paste,
snippets, labels, quote exit and actual rich/embedded DOM carets in all three browsers.
The laboratory checks placeholders; actual MathJax SVG/MathML, anchored comments
and offline HTML export are checked in `tests/e2e/editor-vnext.spec.ts` against the
isolated application in Chromium, Firefox and WebKit.

Current vNext coverage lives in `tests/editor-lab/{editor,productivity,prose}.spec.ts`. The two peers are disposable in-memory documents, not live notes. Per-key assertions compare both sources, the engine's selection and the actual browser DOM/source caret without repairing it between keys. Cases include active source/departure/return, repeated Enter, hard breaks, list/task/quote continuation, nested units, LF/CRLF, marker deletion, menu focus, table click/Select All, concurrent pointer selection, IME, remote rebasing and local undo. `tests/prose-projection.test.ts` and `tests/line-endings.test.ts` check mapping and transaction contracts independently.

`npm run test:dev` verifies port 8080 read-only plus disposable settings scratchpads, and refreshes screenshots and source fingerprints in `test-results/latest-dev-8080/`. Physical macOS IME/system clipboard acceptance remains separate; see [the checklist](EDITOR_VNEXT_ACCEPTANCE.md).

### Retained native rollback coverage

`tests/e2e/native-input-integrity.spec.ts` mounts the actual editor and binding in real browsers without an application server. It types characters separately and checks both canonical source and DOM/source caret after every key; it does not repair the caret between keys. Cases cover grammar transitions, spaces, entity/escape interiors, Unicode, nested and adjacent fences, tables, metadata, range selection, pointer drag, IME, mode switching and competing edits.

The application-level native suite additionally types Markdown character by character into a real collaborative room, checks every update in a second client's Source view, and verifies the first client's next character after a remote insertion. Existing offline, same-account, table, code, math, IME-recovery and permission tests remain release gates.

The harness also holds Backspace/Delete across mixed headings, quotes, lists, code and math, checking exact DOM/source caret after every event and resuming typing afterward. A deterministic equation-preview replacement between mouse-down and mouse-up verifies that asynchronous rendering cannot swallow activation; TeX opens at the mapped body position on mouse-down. See [the verification record](VERIFICATION.md) for final build, browser, backup and live-cutover results. Physical OS IME, physical Safari, every Markdown nesting combination and dense mixed-math performance are not certified by these browser tests. Mobile work is deferred for this desktop phase.
