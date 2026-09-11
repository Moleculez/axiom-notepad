# Axiom Editor vNext

> Historical implementation and local-test log. Commands, ports, build IDs and
> rollout status below describe earlier snapshots, not the current release.
> See [current documentation](../README.md) and [verification](../VERIFICATION.md).

Task-row typography (2026-09-11): task controls now sit in a dedicated grid gutter,
aligned to the first text baseline with a font-relative cap-height adjustment,
instead of absolute line-box offsets. The custom-styled native checkbox is
0.85em with a transparent hit region of at least 24px; pointer activation remains
on the same input, retaining the guarded source edit, caret/range and peer-update
handling. Wrapped lines, nested lists, loose paragraphs and inline code/math keep
their content column. Text activation still opens source prose and hides the
control without leaving a grid column behind. Completed text is not dimmed.
The shared `document-tasks.css` applies to Write, Read, the rollback editor and
self-contained HTML exports. Clipboard HTML keeps its portable inline markup;
CommonMark/GFM conformance output is unchanged. Appearance tokens, forced colors,
keyboard focus and reduced-motion preferences are respected. No dependencies,
stored source, preference schema or collaboration-format changes are involved.
Regression coverage lives in `task-alignment.spec.ts`, `tex-tasks.spec.ts` and the
port-8080 TeX/task scratchpad check; alignment probes use inert clones rather than
mutating editable DOM. Screenshots are written under `data/task-row-design/`.
Verified: 1,433 unit checks; 66 task/math browser checks and 146 prose/footnote
regressions across Chromium, Firefox and WebKit (four pre-existing synthetic-IME
skips); the live port-8080 scratchpad with rendered inline fractions; and an
isolated production build in `.next/task-rows-20260911`. TypeScript, ESLint and
formatting pass. A standalone browser export check also verifies the embedded
task stylesheet. Existing notes and saved appearance preferences were not edited.

Rich footnotes (2026-09-10): typing `[^id]:` keeps the opener editable until Enter,
then opens a titled, blockquote-like container and focuses its first paragraph.
Existing definitions render as the same container. The quiet ID title is read-only;
edit IDs in Source mode. Body paragraphs use the main editor's active-prose rules,
while math, code and tables retain their specialized surfaces. The header and
four-column continuation prefixes remain in Markdown but stay hidden in Write.
Title click and reference click/Enter focus the body; hover and context menus do
not reveal the whole definition. Backspace at the start of an empty body returns
to the sole opener; Enter reopens it. Nonempty first boundaries are protected.
Empty final paragraphs exit, and nested quotes/lists exit their own level first.
`footnote-projection.ts` reuses the pure rich projection on a mapped body slice,
lifting all positions back into the one shared document. It creates no nested
editor, separate history, stored rich state or additional Y.Text. Scoped commands,
paste/composition, language/slash completion, table growth and list indentation
preserve surrounding source. Equation indexing includes definition children once,
in source order. The only schema addition is an ephemeral rich-view container;
there is no stored-document, preference, database or collaboration migration.

Footnote continuation (2026-09-10): Enter/Shift-Enter now preserve the definition's
four-column continuation in Write and Source, including equation/code bodies and
nested lists/quotes. An empty terminal continuation exits the footnote, without
capturing subsequent document paragraphs. The adapter operates on source-mapped
body edits, preserving the definition marker, original delimiters, untouched
spacing, tabs, LF/CRLF, UTF-16 caret positions and author-local undo. The parser
also accepts unindented wrapped prose directly after a footnote paragraph, but
never uses it to cross blank separators, definitions or independent block fences.
Imported new paragraphs and equations still require indentation. No preference,
schema, dependency, checkbox or collaboration-format change is involved.

Footnote previews (2026-09-10): rendered reference numbers show formatted,
document-scoped hover/focus tooltips with Markdown and local MathJax equations.
Cards use the owner's appearance tokens, scroll long definitions, reposition
after preview layout changes and close when their reference leaves the viewport.
Escape dismisses without moving focus; click/Enter navigates to the definition.
The non-editable reference atom is the keyboard link in visual editors, avoiding
Firefox's inability to focus a native link inside editable prose. Native anchors
remain for pointer navigation and reading/export. Secondary clicks remain passive.
Tooltip contents have no copied HTML IDs, focusable links or editing controls.
Existing menus suppress hover previews, and peer updates refresh their contents
without changing source, selections or history. Checkbox behavior is unchanged.

TeX delimiters and task controls (2026-09-10): STEM Markdown now also accepts
`\(...\)` inline and `\[...\]` display math, including standalone multiline
fences, quotes and lists. The parser recognizes them before Markdown escapes;
code/escaped backslashes and CommonMark/GFM remain unchanged. Original delimiters,
UTF-16 offsets and LF/CRLF are preserved. `\[` then Enter creates a rich equation;
empty deletion of its still-owned generated body returns to only `\[`.
Single-line equations retain their delimiters when expanded by multiline edits.
Task checkboxes now apply one guarded source-character edit without selecting the
task text, revealing source, or displacing the writing caret/range. Keyboard Space,
initially unfocused tasks, nested/numbered tasks and read-only states are covered.
A same-text peer replacement of the marker during a press invalidates activation.
There is no dependency, schema, theme, preference or Yjs-format change.

In-document image revision (2026-09-10): left-click or Enter/Space on a selected
image reveals its exact Markdown as ordinary main-editor text. The retained image
is a non-editable decoration below its paragraph/cell, including in quotes, lists
and rich footnotes. Inline sentence text stays above the selected preview; other
images remain rendered. This supersedes the floating, Enter-to-apply source field.
Typing, Enter, selection, clipboard and undo use the normal shared-source pipeline.
Leaving the paragraph collapses valid source; Escape keeps edits and selects the
image for deletion/arrow exit. Incomplete source is shared immediately, while the
local last valid preview is visibly marked. Leaving invalid source preserves its
literal text. Removing all image source removes its preview immediately.
Activation/collapse preserves loaded, pending and failed image states without an
automatic retry; the Retry action remains explicit. Same-address metadata changes
reuse loaded elements. Changed URLs are debounced only
for preview loading; previous content is explicitly labeled, and superseded loads
cannot replace the current image. Disabled/unsafe addresses clear the old preview.
Peer edits rebase source ranges; full peer replacement/deletion drops old ownership.
Code/math menus retain their controls while open and restore the typing caret;
small hover bridges make existing compact toolbars reachable without layout changes.
No document, preference, public API, database or collaboration migration is involved.

Rendered-block refinement (2026-09-10): hover and secondary clicks inspect blocks
without revealing Markdown or moving the typing caret, including macOS Control-click.
Images remain source-backed rendered atoms in active prose, with selection,
keyboard deletion, details, load/error/retry states and loaded-element reuse.
Nested prose quote exits now retain an explicit parent-depth separator, preventing
new typing or paste from becoming a lazy continuation of the child. Quotes inside
list items, repeated exits and LF/CRLF are covered. No dependency, schema,
preference or collaboration-format changes are involved; code-body completion
remains disabled. Verification and screenshots are listed below.

Code-body completion disabled (2026-09-10, user request): keyword/local-name
suggestions, code snippets and the Ctrl+Space trigger have been disconnected from
the editor. Tab/Shift+Tab indent/outdent and Enter stays a newline. Language-name
autocomplete, math completion, syntax highlighting and collaboration remain.
The earlier peer-insertion caret fix and single-opener deletion contract are
retained. No dependency, stored preference or document schema is changed.

Fence/language compatibility fix (2026-09-10): changing or clearing a newly
generated code block's language field no longer revokes its generated closer.
Empty deletion restores the original opening line, without a language popup;
fresh typing can reopen suggestions. Only validated local language-token edits
get this exemption: peer edits, delimiter changes and imported fences remain
protected. Undo/redo now bookmark their current caret before creating the reverse
history entry, so replacement-based restoration lands after the opener too.
No document, preference or collaboration format changes are involved.

Language-completion refinement (2026-09-10): code-language fields and typed opening
fences share a searchable, research-first language catalog with aliases, canonical
info strings and lazy syntax resolution. Suggestions appear after three backticks
or tildes, including quoted/list openers and Source-mode headers. Tab or pointer
selection completes a name; arrows plus Enter select explicitly. Unselected Enter
still creates the block immediately, so ordinary fence typing is uninterrupted.
The hover field is a first-party combobox with matching tokens, viewport-safe menus,
composition guards and source-relative commit/recovery. Custom names remain allowed.
There is no document/preference migration or new dependency.

Generated-fence refinement (2026-09-10): empty deletion of a code/math block
auto-completed by typing its opener and Enter now returns to **just that opener**.
The generated closer, untouched generated spacing and automatic default language
are removed in the same undoable edit as the final body character. The caret stays
after the opener; Enter recreates the rich block without accumulating blank lines.
Explicit languages, container prefixes, neighboring text and line endings survive.
Ownership is local and conservative: pasted/imported, peer-edited or restored
fences keep the existing full-source handoff. There is no document/schema migration.
Permission revocation also keeps literal inputs focusable; read-only deletion keys
cannot accidentally trigger WebKit browser-back navigation.

Retained empty-block behavior: deleting the last code/TeX character closes its
specialized input. Unowned fences reveal their exact Markdown in place; Backspace/
Delete on an already empty unowned input writes nothing. That display intent is
author-local. Simply creating/opening an empty block still opens its rich input.

Divider refinement (2026-09-10): clicking or focusing a horizontal rule keeps it
rendered in Write mode. Its source-backed selection supports direct Backspace/
Delete and author-local undo, without an embedded source editor or toolbar.
Source mode still exposes the authored markers. No stored document, preference
schema or collaboration format changed.

Settings refinement (2026-09-10): Appearance and Writing now place controls on the
left and a resizable Write/Read/Source scratchpad on the right, with independent
scrolling and fixed Apply/Cancel actions. Search, shortcut focus/filtering and
Profile/Notifications forms have matching interaction treatment. This is a
presentation refinement, not an engine or preferences-schema change. See
[settings behavior](../SETTINGS.md).

Status (2026-09-10): LaTeX Article now has hierarchical `§ 1`, `§ 1.1` section
labels, H1–H3 rules and academic dividers. A completed `> ` immediately opens a
source-mapped quote body; a bare `>` stays literal while active. These refinements
preserve the canonical Markdown and author-local history. Paper-like tables have edge append controls and compact
icon panels; LaTeX Article, Paper Ink and Night Paper are optional personal looks.
Active headings retain their H1–H6 typography and editable hash markers.
Slash media insertion, modifier-link navigation, quoted display
equations and source-while-editing prose remain enabled
by default in development at **http://localhost:8080**. Explicit
`NEXT_PUBLIC_AXIOM_EDITOR_ENGINE=native|milkdown` overrides either environment.
The production default remains native until the release gates below pass.

## Product and design contract

The approved direction extends the MIT-licensed Milkdown 7.22.1 / ProseMirror
and CodeMirror 6 cores, with first-party Axiom schema, source mapping, commands,
collaboration adapters and UI. It does not copy Typora's proprietary code, and
does not claim Typora uses Milkdown.

- One canonical `Y.Text("markdown")`; no ProseMirror fragment or document migration.
- Rich state is a projection, never a serialization source. Preserve untouched
  delimiters, list markers, table spacing, escapes, references and line endings.
- Active ordinary prose retains literal inline and structural syntax, except for
  complete rendered image atoms. Headings retain their level-specific typography while real markers stay
  editable. Completed quote prefixes are the exception: `> ` or tab reveals the
  rail immediately, while its body retains literal inline syntax. Bare/unspaced
  quote prefixes stay literal while active. Other syntax hides on caret departure and reveals on deliberate caret return, never hover/right-click. Other list
  items and quote paragraphs remain rendered. Code/math/tables retain specialized views.
- All positions are UTF-16 source offsets. Comments keep their existing encoded
  Yjs-relative anchors and generation checks.
- One author-local Yjs history across rich, source and embedded editors. Do not
  enable Milkdown history/collab or CodeMirror history/basicSetup.
- Preserve the existing server epochs, permissions, journal acknowledgements,
  local outbox, account-scoped recovery and annotation privacy.
- One vertical scroller per mode; the workspace's status footer stays outside it.
- Semantic personal appearance tokens, opaque reading surfaces, comfortable line
  length, restrained borders and shadows; no competing upstream theme or reset.
- Code/math controls appear on hover/focus, tables use edge buttons and compact panels, and keyboard
  focus indicators remain available on controls. No mobile redesign in this phase.
- No left-side block handle or drop indicator. Keep right-click/Shift-F10 and
  keyboard block movement; owned menus/fields do not hide the active prose.
- Unsupported syntax stays visible and source-editable, never silently dropped.

## Code boundaries

`packages/editor/src/` owns shared source transactions, Yjs binding, lossless
projection maps, schema, the Milkdown lifecycle, and CodeMirror setup.
The old native module paths re-export the same shared primitives for rollback.
`prose-projection.ts` creates view-only active source units and mapped blank
paragraphs; `line-endings.ts` preserves existing LF/CRLF during structural Enter.
`generated-fences.ts` tracks this view's Enter-generated scaffolding with Yjs
relative positions. It never claims imported text or another author's delimiter;
peer changes within the block and delimiter replacements revoke ownership.
Explicit local language-control edits update the expected header while retaining
the original opener. The exception validates a single complete info-token edit;
it cannot claim ownership of any new fence or exempt delimiter/body changes.
`code-languages.ts` maps the installed catalog, research aliases and opening-fence
queries without loading grammars. `editor-vnext/language-menu.ts` owns the shared
language option presentation and inline combobox; all completions share overlay
ownership with editor menus and preserve the focused editor's accessible control links.
`code-completions.ts` is a retained, disconnected experiment; neither editor
imports it. There is no code-body suggestion UI, snippet navigation or explicit
completion shortcut. Language-name and math completion still use source edits,
never a whole-document CodeMirror serialization.
Active source headings retain their parsed level and canonical key in the ephemeral
projection, so typography and section numbering survive source reveal; stored Markdown
is unchanged. `quote-prose.ts` maps explicit physical line prefixes and body offsets
for rendering, paste, composition and safe paragraph-level unwrapping.
`packages/markdown/src/containers.ts` maps equation commands and inserted text
through explicit quote/list prefixes; no normalized copy of Markdown is stored.
`packages/markdown/src/footnotes.ts` provides the shared UTF-16 body/prefix map
and scoped command adapter. `packages/editor/src/footnote-projection.ts` lifts
the main rich projection's child nodes and caret spans into each definition.
`packages/editor/src/footnotes.ts` uses the same map for Enter, paste and composing
text. Footnote chrome remains an ordinary node view in the main editor.

`apps/web/lib/editor-vnext/view.ts` adapts the engine to workspace commands,
preferences, research rendering, menus, presence and the existing EditorHandle.
`apps/web/lib/footnote-tooltips.ts` owns the shared passive tooltip lifecycle for
both editor adapters and the React reading view. It resolves the definition from
its current parsed document, not global anchor IDs; no definition text is embedded
in reference attributes. The canonical renderer exports definition-only rendering
with document-wide math/citation context. Tooltip DOM drops copied identities and
interactive affordances before display, while normal document anchors are unchanged.
Its task node view isolates native checkbox activation from prose selection,
preserves keyboard focus, and verifies the pressed marker's source-relative identity.
Its context targets are separate from the typing selection and rebase through
relative positions; a replaced target is not silently reused for a command.
`image-view.ts` owns native image loading and accessible failure/retry presentation.
`image-source.ts` owns only a source-relative activation session and last valid
preview metadata. An optional projection range reveals ordinary mapped text;
non-editable preview decorations have no document positions or serialized content.
Footnote projections map that optional range through their existing body adapter.
Inactive images remain selectable atoms. Preview construction waits for the matching
source projection, so presence updates cannot start a second load before the prior
view releases its loaded element. Image loading is local presentation, never Markdown.
`apps/web/lib/editor-links.ts` owns safe external navigation and the shared
modifier-pointer handoff, including WebKit's automatic Control-click selection.
`apps/web/lib/editor-vnext/find.ts` provides a common source-backed find/replace
panel that does not force visual editing into Source mode.
`diagrams.ts` owns cancellable derived Mermaid previews; `fields.ts` owns the
small, focus-trapped source-field dialogs. `packages/shared/src/editor-looks.ts`
defines coordinated palettes and optional document typography presets.
`table-target.ts` maps transient table targets through Yjs; `table-panel.ts` and
`chrome.ts` provide first-party icon panels/tooltips. `editor-popover.ts` shares
single-overlay ownership with workspace menus. `editor-paper.css` coordinates
document tables/headings/code/math, without changing interface typography.
`packages/markdown/src/section-numbers.ts` derives real-ancestry numbering for the
document index; rich node decorations, reading HTML and export share its attributes.
`packages/shared/assets/document-decorations.css` supplies CSS-only section labels
and academic rules. Source/copy/accessible names and heading anchors stay unchanged.
`apps/web/lib/editor-view.ts` is the deployment switch. The surrounding account,
sync and durable-save lifecycle in `Editor.tsx` is unchanged.

Browser engines are loaded through the existing client-only dynamic Editor
entry. The package root exports server-safe source primitives only.

## Isolated validation

The laboratory uses two disposable in-memory Yjs documents and optional legacy
client interop. It never loads `.env`, writes notes, contacts the database, or
connects to live sync. Its API is a test fixture, not a deployed application route.

```sh
npx tsx scripts/dev/editor-lab.ts
npx playwright test --config editor-lab.config.ts
npx vitest run tests/editor-vnext.test.ts
npm run typecheck
npm run lint
npm test
```

For full application acceptance, use the dedicated test database, port 3002,
sync port 1235 and separate `AXIOM_TEST_DIST_DIR`. Set `SMTP_URL=`. Never point
mutating tests at the live app or restore an old snapshot over current notes.
The running candidate is `http://localhost:3002/workbench/home`. Open it in a
private browser window: it uses isolated test data, and localhost ports otherwise
share authentication cookies. Candidate edits do not update the live database.
Current isolated application build: `.next/settings-panels-r22c-20260910`.
The divider refinement also passes a compile-only production build at
`.next/divider-rendered-r23-20260910`; port 3002 retains the r22c candidate.
The empty-block handoff passes a compile-only build at
`.next/empty-block-source-r24-20260910`. The generated-fence refinement is retained
at `.next/generated-fence-r25f-20260910`. The language-completion build is separate
at `.next/language-completion-r26e-20260910`; current code runs on port 8080, while
port 3002 still retains the r22c candidate.
The fence/language compatibility fix has a separate compile-only build at
`.next/fence-language-conflict-r27e-20260910`.
The earlier code-body completion build is retained at
`.next/code-body-completion-r28d-20260910`; it predates disabling that feature.
Port 8080 serves the latest source; the port-3002 candidate is unchanged.
The normal development configuration uses port 8080 and the latest editor.
It uses the existing local database, not the isolated candidate's test database.
Development assets live in `.next/dev-8080` (or `AXIOM_DEV_DIST_DIR`), never in the
retained production directory selected by `AXIOM_DIST_DIR`. Production defaults
and retained release assets are unchanged. Restart development and reload an
existing browser tab after changing an explicit engine flag.

Run `npm run test:dev` to verify the actual port-8080 UI and regenerate its
desktop screenshots. This separate smoke asserts the rendered editor engine,
tests note-preserving Write/Source/Read switches, checks sixteen palette choices
without saving preferences, and edits only disposable settings scratchpads or
canceled account-form drafts.
The prose scratchpad covers literal heading/task/quote typing, matching active
and resting heading typography, rendering on departure and four visible blank
paragraphs. The equation scratchpad covers
nested quote/callout rendering, multiline TeX, quote-local continuation and
exact source prefixes. The additional LaTeX preview covers both new palettes,
the Column icon panel/tooltips and code/math styling. The decoration scratchpad
shows section numbers/rules and immediate quote-body editing. The settings
scenario checks split resizing, sample preservation, writing/shortcut sections
and canceled Profile/Notifications edits. Code and math scratchpads also check
the imported-block handoff and single-opener autocomplete reversal, caret focus
and undo. Code language-field and typed-fence menus have fresh captures and
keyboard acceptance checks. A separate code scratchpad verifies that body
suggestions and snippet expansion are disabled, while Tab/Shift+Tab indentation
and Enter continue working. The rendered-block scratchpad checks passive context
inspection, selected-image deletion/undo and nested-quote parent continuation.
The TeX/task scratchpad adds actual MathJax rendering of bracket/parenthesis
delimiters, caret-preserving task clicks and source-exact multiline editing.
The footnote scratchpad adds light/dark formatted hover cards, real inline/display
MathJax rendering, keyboard focus in Read mode and unchanged source/preferences.
The rich-footnote scratchpad authors its opener/Enter transition, body paragraphs
and embedded equation, with light/dark container and active-TeX captures.
Thirteen scenarios produce forty-seven current desktop screenshots.
It requires the existing local seed account and never seeds or migrates data.
Images are in `test-results/latest-dev-8080/`, with a dedicated report in
`playwright-report/dev-service/`. Each screenshot has a report attachment with
its capture time, origin, rendered engine (null on pages without an editor) and
relevant-source fingerprint, including the split/settings components and CSS.
Captures wait for visible equation and diagram previews to finish. This is not
the full release acceptance suite or physical IME acceptance.

The lossless projection uses strict ProseMirror replacement steps. If a minimal
structural slice cannot join exactly, it replaces the **view document**, not
`Y.Text`. The interactive replace fitter must never invent an extra table cell.
Omitted table cells keep a local visual identity until authored; clicking an empty
cell does not pad or normalize a Markdown row.

Pair ownership follows actual Yjs deltas, including another author's same-text
replacement. Only locally generated, still-valid closers can be skipped/deleted.
CodeMirror key handling runs after Axiom commands, so table scope, shared undo,
mode switching and embedded-editor exits cannot be intercepted by default keys.

## Source-while-editing refinement

- Headings, ordinary paragraphs, list/task items and quote paragraphs retain all
  authored syntax while active. Other items/paragraphs render independently.
  Pending prefixes (`#`, `-`, `1.`, `>`) keep a literal caret, even before existing
  content. Structured code/math/table descendants are never flattened.
- Active H1–H6 headings keep the same font, weight, scale, line height and margins
  as resting headings. Their real `#` markers stay editable with a quiet tint;
  removing the heading marker returns to paragraph typography. Level changes,
  including peer changes, retain source-based carets and author-local undo.
  Setext underlines remain literal; no fake markers or source normalization.
- Enter creates a paragraph; Shift-Enter creates a hard break (headings exit to
  a paragraph). Lists/tasks/quotes continue on Enter, and empty items exit/outdent.
  Every additional blank paragraph has an editable mapped position, including
  leading, intermediate and trailing gaps. Backspace removes one blank gap.
- LF/CRLF and mixed-ending notes retain untouched source exactly. Active source
  maps normalize CRLF only for display. Structural Enter uses mapped temporary LF
  coordinates and inserts the surrounding line-ending convention.
- Deleting inside visible syntax is literal, not a premature structural unwrap.
  The existing code/math/table boundary protections remain in force.
- Mouse release captures the real browser selection before changing the display.
  Incoming peer deltas rebase selections made against the frozen DOM. This fixes
  stale-caret table clicks and cell-scoped Select All replacing the whole note.
- Prefix tint inherits the document's font and size. There are no left-side
  block handles/drop indicators. Context menus, keyboard moves, source offsets,
  annotations and author-local history remain shared across modes.

See [the typing contract](../TYPING_INTEGRITY.md) for engine details and tests.

## Display equations inside quotes

In STEM Markdown, complete line-start display fences interrupt prose without
requiring blank separators. Quotes, nested quotes, callouts and quoted list items
use the same renderer, equation numbering and editor as top-level mathematics:

```markdown
> [!THEOREM] Energy
> The rest-energy relation is
>
> $$
> E=mc^2\label{energy}
> $$
>
> Continue the derivation here.
```

- Type `$$` then Enter inside a quote, choose `/math` → Display equation, use
  Mod-Alt-B, or choose Display equation from the prose context menu. Every entry
  point retains quote depth and list indentation and focuses the actual TeX body.
- Mod-Enter finishes an equation into a mapped paragraph at the same quote depth.
  It reuses an existing blank continuation. Enter on an empty quoted paragraph
  exits one quote level. Insert paragraph before preserves a first-line list marker.
- TeX editing hides quote prefixes. Enter, multiline paste, matrix/cases/aligned
  snippets, Tab field navigation and labels preserve prefixes and LF/CRLF.
  Selected TeX indentation is not mistaken for a container prefix.
- One-line `$$…$$` remains unchanged on opening. A multiline body edit expands it
  to fenced form in the same undo step; adjacent empty fences gain a real body
  line on first input. Incomplete/cross-container fences and code stay literal.
- Cross-container insertion selections stay unchanged with an explanation.
  Neighboring active prose remains literal while equations keep their own preview.
- Embedded source maps refresh even when the rich engine reuses an unchanged node.
  A peer inserting text above an equation cannot leave its caret at stale offsets.
  Discussion anchors, mode switches, offline persistence and author-local undo
  continue to use the existing shared `Y.Text` and permissions.

No dependency, schema, theme, preference or sync-protocol changes are introduced.
Quote and callout surfaces reuse existing typography, spacing, opaque equation
previews and hover/focus controls; no permanent block handle or extra toolbar.

## Productivity refinement delivered

- Code-body completion and snippet expansion are disabled at the user's request.
  Neither typing nor Ctrl+Space opens code suggestions; Tab indents and Enter
  inserts a newline. Math fields cannot capture code indentation. Tests:
  `editor-lab/code-completion.spec.ts`.
- Opening code fences and the code-language field share optional, alias-aware
  suggestions, with research languages first and unknown custom names preserved.
  Tab completes a token; arrows/Enter or pointer select. Bare/typed fence Enter
  without an explicit suggestion selection preserves existing block creation.
  Selection and dismissal never rewrite the code body or adjacent text. The
  combobox retains DOM focus, validates source-relative targets after peer edits,
  and retains drafts on permission revocation or overlapping changes. Syntax
  loading recognizes research aliases without rewriting stored info strings.
  Tests: `code-languages.test.ts` and `editor-lab/languages.spec.ts`.
- Deleting all visible code/TeX text (including selected contents or an owned
  pair) reveals that block's Markdown in the rich document. A block created by
  typing an opener and Enter collapses to the authored opener, removing only
  still-owned generated scaffolding in one local undo step. Explicit language
  labels survive; an automatic default language is undone with the completion.
  Local language-field changes no longer revoke the generated closer; reversal
  returns to the original opener rather than leaving a paired empty block.
  Completion dismissal and saved redo carets survive that source replacement.
  New following text retains the separators it needs; peer-modified spacing
  never disappears. Undo restores the block and focus; redo restores the opener.
  For unowned/imported fences, Backspace or Delete on an already empty embedded
  input performs a zero-write, full-source handoff.
  A relative bookmark rebases the local display intent across peer edits; its
  projection is active only for the targeted empty block. Existing empty blocks
  do not change simply because they are opened, and nonempty bodies keep their
  specialized surfaces. Undo/redo, quoted CRLF content and permissions remain
  source-backed. Tests: `literal-source.test.ts`, `generated-fences.test.ts` and
  `editor-lab/{empty-blocks,generated-fences}.spec.ts`.
- Source-mode slash insertion and LaTeX suggestions use the active CodeMirror
  caret. Embedded equation menus follow their own caret, reposition on scrolling,
  stay inside the viewport and close during composition or permission changes.
- Inline TOCs, front matter and link definitions
  have inactive previews. Focusing one reveals its ordinary editable source;
  simply viewing or switching modes does not normalize Markdown or CRLF endings.
- Footnote definitions have titled rich child blocks in Write, not whole-definition
  source editors. Source and the native rollback retain literal definition access.
- Mermaid previews render in Write and Read, debounce edits, discard stale jobs,
  respect personal colors and retain the last valid rendering on syntax errors.
  Preview input is limited to 30,000 characters; strict mode and blocked external
  resource syntax prevent diagrams from loading remote image resources. Source
  remains editable when previewing fails. Arbitrary HTML execution is not enabled.
- Equation/footnote/TOC links navigate in Write without editing source. Citations
  reach a derived bibliography; footnote definitions are not duplicated there.
  Context changes refresh inline and block previews even if that block is unchanged.
- Context menus edit link/image destinations, labels and titles, and researcher
  block titles. Relative source bookmarks rebase disjoint peer edits; overlapping
  edits or revoked permission preserve the local draft in recovery. Code-language
  drafts are also retained on revocation. Explicit Cancel/Escape discards a draft.
- Table menus include row/column movement and default/left/center/right alignment.
  Select All inside a cell first selects that cell; a second invocation expands
  to the document. Typing over a mixed-block selection uses source transactions.
- Context menus and keyboard commands move exact source ranges through one
  undoable action; the former hover-only block handles have been removed.
  Deleting/reinserting anchored text (including moving a block)
  follows existing annotation semantics: preserve the original quote and mark an
  unresolved anchor, never silently retarget it to similar text.
- Source scrolling no longer traps wheel events inside an overflow-hidden wrapper;
  the document scroller owns it, so live outline tracking and the fixed footer agree.
  Discussion navigation retains selection when switching Source to Write.
- The earlier six palettes brought the total to fourteen: Pearl/Carbon, Ivory/Espresso and
  Mist/Deep Sea. Modern, Journal, Compact Research and Accessible document styles
  are opt-in, editable starting points. Settings include an isolated editable
  preview. Document font choices no longer change settings/interface headings.

Those earlier themes used complete semantic-color overrides on existing preset IDs. No
preference schema, theme-file version, stored-note format or sync protocol changed in that refinement.
Existing clients can still read the saved colors. Choosing a preset intentionally
replaces that mode's custom colors; Cancel restores the previous appearance.

## Paper-style tables and LaTeX Article

- Tables use square horizontal rules, document typography, tabular numerals and
  faint cell guides only during interaction. Right/bottom-edge plus buttons append
  a column/row to that table and focus the new cell. Top-right alignment, TSV copy
  and more icons share accessible hover/focus tooltips. The compact panel has
  Row/Column/Table tabs, keyboard navigation and explanatory disabled states.
- More, right-click and Shift-F10 use the same anchored non-modal panel. Escape
  restores the mapped caret; outside dismissal releases editing focus. A separate
  overflow scroller keeps toolbar hit regions and popovers out of the grid.
  Read-mode tables have a local scroll frame and fill their reading column.
- Targets retain Yjs-relative row boundary identities, not stale numeric offsets.
  Disjoint/cell-text edits rebase; structural replacement/movement invalidates
  actions. Detail fields also reject overlapping changes before opening. Read-only,
  composition, 100-column/1,000-row, header and final-column guards remain enforced.
- Row/column edits, moves and growing pastes preserve physical LF/CRLF endings,
  mixed endings, quote/list prefixes and unterminated EOF. Presentation, local
  resizing, tooltips and menus never create Y.Text updates. Source edits retain
  author-local undo, including after a peer inserts content before the table.
- Code has a flat square surface and equations sit unboxed on paper. Hover/focus
  controls preserve the embedded caret. First-block controls reserve space within
  the document viewport instead of becoming clipped above it. Write/Read headings
  and code share the same typography roles, with quieter quotes/references.
- LaTeX Article is an opt-in document preset: self-hosted Latin Modern Roman,
  19px prose, 1.65 line height, 70ch, 0.8em paragraphs, bold serif headings at
  scale 0.9 and 14px IBM Plex Mono. Four Latin Modern faces, notices, full license
  and a reproducible conversion script are included. Personal HTML embeds the
  fonts; all four WOFF2 assets are in the offline manifest. Default typography
  and standard-export opt-in behavior remain unchanged.
- Paper Ink and Night Paper bring the total to sixteen palettes; LaTeX Article
  brings document styles to five. Palette and typography choices are independent.
  Apply/Cancel and category navigation retain the existing shared preference draft.
- Appearance v3 added `latinModern`; v4 adds `documentDecorations: none | latex`.
  v1/v2/v3 records and pending local outboxes normalize without resetting values.
  Exact old LaTeX Article signatures enable decorations; other old profiles use none.
  Current clients advertise `X-Axiom-Appearance-Schema: 4`; legacy reads return
  representable v2/v3 or HTTP 426,
  and legacy writes are rejected before mutation. Writing stays v2 and portable
  palettes stay v1. No database DDL, Markdown or collaboration migration is needed.

## Numbered academic headings and live quote bodies

- LaTeX Article enables H1–H3 bottom rules, H1–H6 hierarchical section labels and
  square double-rule dividers. The saved Typography → Document decorations choice
  survives font/size/spacing/color edits; another document preset resets it.
- Dividers remain rendered even while selected. A lightweight node view selects
  their canonical range for the existing delete/cut/history path, without creating
  an embedded text surface. Pointer and keyboard focus resolve current projection
  offsets; read-only divider focus blocks accidental Backspace browser navigation.
- Number real heading ancestry (including nested/setext headings), not fixed-level
  zero-filled counters. H1/H2/H2/H1/H2 becomes 1/1.1/1.2/2/2.1; starting at H2 or
  skipping levels creates no phantom parents. Duplicate titles retain existing IDs.
  Collaborator edits, level changes and block movement reflow the derived labels.
- Resting labels occupy a reserved, length-aware gutter. Active headings keep
  that geometry and their bottom rule but show real editable hashes, not labels.
  Read, personal HTML and print share the same decorations; app titles, TOC labels
  and footnote separators do not gain them. These are not Markdown counters.
- `> ` or tab immediately opens an editable empty quote body. Bare `>` and
  `>text` remain raw while active. Explicit quote prefixes hide without hiding
  body Markdown; selection is mapped to canonical UTF-16 offsets on every line.
- Enter continues/exits; Backspace at the first body position unwraps one paragraph
  level per undo step; internal line boundaries join without stranded prefixes.
  Empty/nested/lazy quotes, CRLF/mixed endings, paste and composition use the same
  prefix adapter. Source-mode carets explicitly within markers still reveal source.
- Code/math/tables inside quotes retain their specialized editors. None of these
  projections, settings previews or mode switches produces a Y.Text update.

## Media insertion and link navigation

- `/image`, `/attachment`, `/file`, `/upload` and `/pdf` offer the Explorer picker
  in Write and Source. Choose a ready file or upload to the note's shared space.
  Images embed; other files become protected, version-pinned links.
- Slash media commands hand the full query to `Editor.tsx`'s existing relative
  insertion bookmark instead of the synchronous Markdown formatter. They do not
  select or remove the query while the picker is open. The host does not overwrite
  that bookmark with the visible caret. Cancel preserves text and caret; insertion
  is one undo step. Peer insertions above rebase it; edits replacing the query are
  rejected without overwriting the collaborator.
- Command/Control-click preserves the editing caret and opens a link exactly
  once. Literal links in active prose/Source resolve through canonical source
  positions. Notes, attachments and headings keep local navigation; external
  HTTP/HTTPS/mailto targets no longer fall through to note search. Unsafe schemes
  are blocked, and new tabs have no opener access. Plain clicks, right-click menus
  and dragging away from a pressed link retain their separate behavior.
- Regression tests live in `tests/editor-links.test.ts`,
  `tests/editor-lab/media-links.spec.ts` and `tests/e2e/editor-media-links.spec.ts`.
  Application uploads use new isolated test resources, never existing live notes.

## Verified candidate coverage

- Latest in-document image revision: TypeScript, ESLint, formatting and all
  **1,356 unit tests** pass. The clean full laboratory run passes **969 checks
  across Chromium, Firefox and WebKit**, with **27 conditional skips** (25
  existing, plus two non-Chromium image CDP composition cases), in
  `data/image-inline-full-lab-r36h/`. Coverage includes ordinary image source
  above its retained preview; immediate shared typing; invalid source and
  deletion/undo; nested quotes, lists, tables and rich footnotes; LF/CRLF;
  source-mode caret preservation; clipboard without duplicate preview content;
  peer rebasing/replacement; read-only transitions; passive hover/context
  actions; keyboard activation; loading/error/retry ownership; and stable
  compact code/math menus. Nine appearance checks verify Paper, Night and large
  prose text across all three browsers, including long-address wrapping and
  reduced motion. Their synthetic figure captures are linked from
  [current screenshots](../../test-results/README.md).
  All **17 live port-8080 scenarios** pass, refreshing **47 screenshots** and
  retaining the shared empty-state hydration regression checks. The compile-only
  production/offline build passes in `.next/image-inline-r36h-20260910`
  (575 offline assets). No shared notes, saved preferences, database/schema,
  dependencies, native rollback engine or port-3002 candidate were changed.
  Durable application acceptance and physical IME/system clipboard acceptance
  remain separate release gates; simulated browser coverage does not close them.
- Previous rich-footnote revision: TypeScript, ESLint, formatting and all **1,332
  unit tests** pass. The clean full laboratory run passes **893 checks across
  Chromium, Firefox and WebKit**, with **25 conditional skips** (23 existing,
  plus two non-Chromium CDP composition cases), in
  `data/footnote-rich-full-lab-r35e/`. The new rich-footnote suite contributes
  **64 passes and two skips**: opener/Enter, paragraphs and exits, empty deletion
  and undo/redo, exact LF/CRLF/tab carets, nested quotes/lists, code/math fences,
  language/slash completion, first-line tables, paste, media/link actions,
  Chromium composition and peer/permission changes. The previous preview and
  continuation suites also pass. All **13** live port-8080 scenarios pass and
  refresh **47 screenshots**, including light/dark rich footnotes and real
  MathJax editing in an unsaved scratchpad. The compile-only production/offline
  build passes in `.next/footnote-rich-r35d-20260910` (575 offline assets).
  Shared notes, saved preferences, database/schema and the port-3002 candidate
  remain unchanged. No dependency or stored-document migration was introduced.
  Durable application acceptance and physical IME/system clipboard acceptance
  remain separate release gates; simulated composition/clipboard tests do not
  claim to satisfy them.
- Previous footnote-continuation revision: TypeScript, ESLint, formatting and all
  **1,311 unit tests** pass. The complete laboratory passes **829 checks across
  Chromium, Firefox and WebKit**, with **23 pre-existing conditional skips**
  (`data/footnote-continuation-full-lab-r34d/`). The focused footnote suite passes
  **66 checks**, including Write/Source Enter, typed dollar/bracket equations,
  nested-container exits, exact caret/undo/peer behavior and rollback Source CRLF.
  All **twelve** live port-8080 scenarios pass and refresh **44 screenshots**;
  the footnote scratchpad authors a new continuation and verifies it in both the
  formatted tooltip and exact source. The compile-only production/offline build
  passes in `.next/footnote-continuation-r34d-20260910`. Saved notes/preferences,
  database/schema, checkbox handling and the port-3002 candidate remain untouched.
  Durable application acceptance and physical IME/clipboard gates remain separate.
- Previous footnote-preview revision: TypeScript, ESLint, formatting and all
  **1,282 unit tests** pass. The complete laboratory passes **796 checks across
  Chromium, Firefox and WebKit**, with **23 pre-existing conditional skips**
  (`data/footnotes-full-lab-r33e/`). Coverage includes formatted hover/focus,
  Firefox keyboard navigation, caret/history preservation, peer updates,
  overlay suppression, scrolling, legacy rendering and independent React
  reading panes. All **twelve** live port-8080 scenarios pass and refresh
  **44 desktop screenshots**, including light/dark footnote previews with real
  MathJax and keyboard focus in Read mode. The compile-only production/offline
  build passes in `.next/footnotes-r33d-20260910`. No shared notes, saved
  preferences, checkbox behavior, database/schema or port-3002 candidate were
  changed. Durable application acceptance and physical IME/clipboard gates
  remain separate.
- Previous TeX-delimiter/task revision: TypeScript, ESLint, formatting and all
  **1,277 unit tests** pass. The full laboratory passes **763 checks across
  Chromium, Firefox and WebKit**, with **23 pre-existing conditional skips**
  (`data/tex-task-full-lab-r32b/`). All **eleven** live port-8080 scenarios pass
  and refresh **41 desktop screenshots**, including real MathJax inline/display
  output, rendered checkbox toggles and bracket-equation editing. The first new
  live assertion was corrected to allow MathJax's multiple inline SVG fragments;
  no renderer change was required. The compile-only production/offline build
  passes in `.next/tex-task-r32b-20260910`. Existing notes and saved preferences
  were not changed; port 3002 retains its prior candidate. Durable application
  acceptance and physical IME/clipboard gates remain separate.
- Previous image-click/source revision: TypeScript, ESLint, formatting and all
  **1,218 unit tests** pass. The complete laboratory passes **718 checks across
  Chromium, Firefox and WebKit**, with the same **23 conditional skips** noted
  below (`data/image-source-full-lab-r31d/`). All **ten** live port-8080 scenarios
  pass and refresh **39 screenshots**, including the simultaneous image/source
  presentation, left alignment and outline-free field. Controlled loaded-image
  captures are linked in [the screenshot index](../../test-results/README.md).
  The compile-only production/offline build passes in
  `.next/image-source-r31d-20260910`. No database/schema changes or release cutover
  were performed; durable application acceptance and physical IME/clipboard
  gates remain separate.
- Rendered-block refinement: TypeScript, ESLint and all **1,215 unit tests** pass.
  The complete editor laboratory passes **694 checks across Chromium, Firefox and
  WebKit** (`data/rendered-blocks-full-lab-r30i/`). Its **23 intentional skips**
  are twenty Chromium-only synthetic-composition entries on other browsers and
  three opt-in performance entries; physical OS input acceptance remains separate.
  All **ten** live port-8080 scenarios pass, with **39 refreshed desktop captures**
  and current source fingerprints. Controlled loaded-image and failure-state
  captures are separate port-3003 laboratory evidence; see
  [the screenshot index](../../test-results/README.md). Production compilation,
  TypeScript, static generation and the offline asset build pass in the fresh
  `.next/rendered-blocks-r30i-20260910` directory. This was a compile-only build:
  no database initialization, migration, seed, restore or live-note edit was
  performed, and port 3002 was not cut over. Durable application acceptance and
  physical IME/system clipboard gates were not rerun for this refinement.
- Code-body completion disabled: TypeScript, ESLint, formatting and all **1,199
  unit tests** pass. The targeted code/language/productivity/quoted-equation
  laboratory suite passes **175 checks across Chromium, Firefox and WebKit**;
  two pre-existing non-Chromium synthetic-composition cases remain skipped.
  Artifacts: `data/code-completion-disabled-lab-r29b/`. All **nine** live port-8080
  scenarios pass with **36 refreshed desktop captures**, including ordinary code
  indentation and newline entry without autocomplete or snippet expansion.
  Existing note content and saved account preferences are unchanged. The full
  laboratory suite, production build, durable application acceptance and physical
  OS IME/clipboard gates were not rerun for this disabling change.
- Earlier code-body completion (historical, before disabling): **1,199 unit tests**, TypeScript, ESLint,
  formatting and the isolated r28d production build pass. The full laboratory
  passes **607 checks across Chromium, Firefox and WebKit**, including 33 code-body
  completion cases; 23 pre-existing synthetic-IME/opt-in benchmark entries are
  intentionally skipped. Artifacts: `data/code-body-completion-full-lab-r28d/`;
  targeted checks: `data/code-body-completion-lab-r28c/`. All **nine** live port-8080
  scenarios passed, producing **36 desktop captures**, including local code
  suggestions and snippet fields. Existing research notes and saved account
  preferences are unchanged. Durable application acceptance and physical OS
  IME/clipboard gates were not rerun.
- Retained fence/language compatibility fix: **1,168 unit tests**, TypeScript,
  ESLint, formatting and the isolated r27e build pass. The full laboratory
  passed **574 checks**, with 23 intentional skips, across Chromium, Firefox and
  WebKit. All eight live port-8080 scenarios passed with 34 fresh captures.
  Artifacts: `data/fence-language-conflict-full-lab-r27e/`; targeted undo/caret
  checks: `data/fence-language-conflict-history-r27d/`. Imported and peer-owned
  fences retain their conservative source handoff.
- Retained language-completion refinement: **1,152 unit tests**, TypeScript,
  ESLint, formatting and the isolated r26e production build pass. The full
  editor laboratory passes **553 checks across Chromium, Firefox and WebKit**,
  including 39 language-menu cases. Twenty Chromium-specific synthetic IME
  entries and three opt-in benchmarks remain skipped as intended.
  Artifacts: `data/language-completion-full-lab-r26e/`; targeted language checks
  are in `data/language-completion-lab-r26d/`. All eight live port-8080 scenarios
  pass, producing **34 fresh desktop screenshots**, including both autocomplete
  entry points. Existing live note/account content is unchanged. Durable
  application acceptance and physical OS IME/clipboard gates were not rerun.
- Retained generated-fence refinement: **1,120 unit tests**, TypeScript, ESLint,
  formatting and the isolated r25f production build pass. The full editor
  laboratory passes **514 checks across Chromium, Firefox and WebKit**, including
  45 generated-fence cases and the previous empty-block, divider, table, prose,
  code/math and collaboration regressions. Twenty Chromium-specific synthetic
  IME entries and three opt-in benchmarks remain skipped as intended.
  Artifacts: `data/generated-fence-full-lab-r25f/`; the targeted read-only focus
  checks are in `data/generated-fence-permission-r25e/`. All eight live port-8080
  smoke scenarios passed and produced 32 desktop screenshots at that time, including
  single-opener code/math handoffs and preservation of imported full-source blocks.
  Existing live note/account data is unchanged. Durable application acceptance
  and physical OS IME/clipboard release gates were not rerun for this change.
- Retained empty-block refinement: **1,091 unit tests**, TypeScript, ESLint and
  the isolated r24 production build pass. The full editor laboratory passes
  **469 checks across Chromium, Firefox and WebKit**, including 42 new empty-block
  cases and the previous divider, table, prose, code/math, media/link and
  collaboration coverage. Twenty Chromium-specific synthetic IME entries are
  skipped on the other engines, and three opt-in benchmark entries are skipped.
  Artifacts: `data/empty-block-source-full-lab-r24/`; the targeted handoff run is
  `data/empty-block-source-lab-r24b/`. All eight port-8080 smoke scenarios pass,
  producing 30 screenshots at that time, including empty code/TeX returning to source.
  Live note/account data is unchanged. Durable application acceptance and
  physical OS IME/clipboard release gates were not rerun for this change.
- Retained divider refinement: 1,077 unit tests, TypeScript, ESLint and the isolated r23
  production build pass. Across Chromium, Firefox and WebKit, 18 new divider
  checks and 137 nearby prose/productivity/decoration regressions pass; four
  Chromium-only synthetic IME entries are skipped on other engines. Artifacts:
  `data/divider-rendered-lab-r23b/` and `data/divider-rendered-regressions-r23/`.
  Its port-8080 run passed all eight smoke scenarios, including rendered divider
  click, Backspace and undo in the disposable scratchpad, with 28 captures at that time.
  This is targeted regression coverage, not a rerun of the full laboratory or
  durable application acceptance suite.
- Retained r22c application acceptance: **40 passing checks** (24 Chromium,
  eight Firefox, eight WebKit). The new settings checks cover independent pane
  scrolling, pointer/keyboard resizing, preview preservation, desktop overflow,
  search/shortcut focus and Profile/Notifications save, cancel and failure paths.
  Decoration/pending-v3-outbox checks pass in all three browsers; Chromium also
  covers preference bundles, existing paper tables, pending-v2 migration, account
  menus and productivity settings. Reports are in
  `data/settings-panels-r22c-reports/`; artifacts are in
  `data/settings-panels-r22c-app-{chromium,firefox,webkit}/`.
  Its port-8080 run separately passed eight note-preserving/scratchpad/account-draft
  scenarios with twenty-eight captures and source fingerprints; live notes and
  saved appearance, profile and notification settings were unchanged.
- Retained r21 Chromium, Firefox and WebKit evidence: 409 passing editor-laboratory checks, including
  hierarchical section labels, peer heading-level changes and block moves,
  active/resting geometry, Read-mode rules, quote-body input and per-level undo.
  Table-panel/edge, nested/EOF, field-target, embedded-caret, heading and media/link
  coverage remains enabled. Twenty Chromium-specific synthetic IME
  cases are skipped on the other engines, and
  three opt-in benchmark entries are skipped in the ordinary run. The r16 benchmark
  below is historical. The laboratory was not rerun for this settings-only
  refinement; its engine was unchanged. Synthetic IME checks do not establish
  OS IME parity.
- Retained r21 application acceptance: **44 passing checks** (18 Chromium,
  13 Firefox, 13 WebKit). These cover persistent/customized decorations,
  preview/cancel/reload, Write/Read and offline HTML numbering, quoted-body
  collaboration and undo, v3 compatibility/pending drafts, existing paper-table
  operations, v2 migration, heading/quoted-equation discussions, offline convergence
  and the Chromium preference-bundle suite. Reports are in
  `data/editor-decorations-r21-reports/`; artifacts are in
  `data/editor-decorations-r21-app-{chromium,firefox,webkit}/`.
  This is historical evidence for the decoration/quote engine refinement, not a
  full rerun of those 44 scenarios for the settings layout.
- Historical r19b paper candidate application acceptance covers saved edge actions, peer rebasing
  and undo/reload; LaTeX/palette preview/cancel/persistence, matching Write/Read
  metrics and offline font export; legacy API compatibility and old pending outboxes.
  Existing heading, quoted-equation, discussion, upload, link, settings, account-menu
  and sidebar checks passed then: **47 application checks** (26 Chromium,
  nine Firefox, nine WebKit, plus three Chromium lifecycle/ten-client/offline-shell
  checks). The pending-v2-outbox case also passes three repeated startup checks.
  Retained reports are in `data/editor-paper-reports/`; final application artifacts
  are in `data/editor-paper-app-r19b-{chromium-final,firefox,webkit-final}/` and
  `data/editor-paper-lifecycle-final/`. This broader application run is retained
  historical evidence, not a full rerun for the decoration/quote refinement.
- Previous productivity candidate acceptance: 80 passing desktop scenarios across editor integration,
  settings, preferences, account menus, sidebar trees, administration, Trash,
  Explorer, research/PDF workflows, collaboration, offline recovery and security.
  Those broader 80 checks are historical evidence, not a rerun of this paper-style
  refinement. Neither run is the complete legacy native-editor E2E suite.
- Visual/source/embedded editing shares one author-local Yjs undo; native/new
  client interop, two persisted clients, offline reconnection/reload, ten CRDT
  clients and active membership revocation are tested.
- Real discussion anchors render and navigate in visual mode; deleting their
  original text leaves the discussion and its original quoted text intact.
- Context table operations, omitted cells, cell rectangles, TSV paste/copy,
  local resizing, paired fences, code-language fields, arrow-key transitions,
  slash commands, Unicode deletion, source switching and find/replace are covered.
- Settings scratchpads use the candidate engine without providers or note/file
  writes. Theme color controls, saved preferences and the pinned footer are tested.
- Retained earlier isolated durability fault injection passed: acknowledged text survives a sync
  process crash, snapshot write failures never report success, the binary journal
  restores missing snapshot text, and graceful shutdown drains persistence. Only
  temporary test fixtures/roles were removed; live notes and backups were untouched.
  This fault-injection run was not repeated for the paper-style refinement.

The browser clipboard fixture supplies an explicit `DataTransfer` because Firefox
does not adopt synthetic `ClipboardEvent` constructor data. It proves the handler
contract; manual system clipboard acceptance remains separate.
The in-memory laboratory checks equation placeholders and editing without loading
the application MathJax host. Actual worker-rendered SVG/MathML is verified by the
isolated application and port-8080 scratchpad tests, not inferred from placeholders.

### Same-machine typing benchmark

Quoted-equation candidate r16, 2026-09-09, Chromium on this macOS machine.
Each figure is input-to-next-frame p95
over 50 single-character edits. Both engines have the same in-memory CodeMirror
source peer; samples exclude server/network latency. These are measurements, not
a promise that the candidate is faster for every document or operation.

| Source size / position   | Native baseline | Candidate |
| ------------------------ | --------------: | --------: |
| 100,000 characters / top |         14.3 ms |   16.0 ms |
| 100,000 / middle         |         15.6 ms |   16.0 ms |
| 100,000 / end            |         15.7 ms |   16.1 ms |
| 980,000 / top            |        148.7 ms |   81.0 ms |
| 980,000 / middle         |        115.9 ms |   82.0 ms |
| 980,000 / end            |         79.4 ms |   82.9 ms |

All candidate p95s pass the executable limits: under 50 ms for 100,000 characters
and under 200 ms for the near-limit note. Source convergence and exact final
length are also asserted. Run without concurrent builds or browser suites:

```sh
AXIOM_EDITOR_BENCHMARK=1 npx playwright test --config editor-lab.config.ts --project chromium --workers 1 --grep 'benchmark 50'
```

## Remaining work before default rollout

This is an expanded gated implementation, not a claim of complete Typora parity.

- Physical Chinese/Japanese IME and system clipboard acceptance on macOS remain
  unverified. Synthetic browser events, CDP composition and supplied DataTransfer
  objects are not OS acceptance. Follow the [manual checklist](../EDITOR_VNEXT_ACCEPTANCE.md).
- Port and execute the remaining native-DOM-specific editor regression matrix
  (`editor.spec.ts`, `native-editor.spec.ts`, and the native input harness) against
  the new surface. The application and cross-browser candidate suites are not a
  substitute for every old interaction, composition/permission and accessibility case.
- Advanced structured workflows remain follow-ups: richer front-matter forms,
  reference-definition-aware link refactoring, more specialized researcher block
  inspectors, and complete long-document/native selection parity. Current metadata
  and definitions are source-editable; unsupported syntax is never dropped.
- Promote only after those gates pass, with a fresh live backup, retained prior
  assets and a read-only live smoke. The production default is intentionally unchanged.

## Release gates

Implemented candidate coverage is tracked by executable tests, not by the
presence of a UI control. These gates remain mandatory before changing production default:

- [x] Shared source package and unchanged native rollback paths.
- [x] Milkdown lifecycle/schema and CodeMirror source/code/TeX surfaces.
- [x] Lossless no-op mode switches, mapped typing and active prose source reveal.
- [x] Source-based list, quote, fence, table and formatting commands.
- [x] Single Yjs history and mixed native/new client interoperability tests.
- [x] Scripted composition/remote rebasing and conflicting-range draft recovery.
- [x] Baseline cross-browser input, selection, deletion and clipboard handlers.
- [x] Cell rectangles, display-only resizing, omitted cells and spreadsheet paste.
- [x] Source-anchored discussion highlights and visual-mode navigation.
- [x] Source and embedded-caret completions; definition and diagram previews.
- [x] Contextual field recovery, table movement and keyboard/context block moves.
- [x] Visible blank paragraphs, literal marker deletion and LF/CRLF Enter.
- [x] Browser caret capture on mouse release and concurrent-peer rebasing.
- [x] Quote/callout display equations, mapped continuation, multiline TeX and labels.
- [x] Embedded caret rebasing after peer edits and quoted-math discussion/export tests.
- [x] Sixteen coordinated palettes and five optional document styles.
- [x] Source-relative compact table panels, edge append, tooltips and first-block controls.
- [x] LaTeX font assets, lossless appearance-v4 compatibility and personal HTML embedding.
- [x] Hierarchical section labels, academic rules and persistent customization.
- [x] Immediate quote bodies, mapped multiline input and per-level unwrap history.
- [x] Passive block inspection, rendered image selection/loading/details and nested prose quote exit carets.
- [ ] Complete cross-browser and table interaction parity matrix.
- [ ] Complete researcher rendering, completions, outline and discussion highlights.
- [ ] All existing browser regression suites against the candidate application.
- [x] Same-machine large-document typing benchmark, 50 edits top/middle/end.
- [ ] Physical Chinese/Japanese IME acceptance on macOS (synthetic tests do not prove this).
- [ ] Backed-up deliberate release with retained old assets and read-only live smoke.

Rollback: rebuild without the flag (or set it to `native`) and retain static assets
from prior releases. Switching engines in this release needs no Markdown or
collaboration migration. Retain the appearance-v4 compatibility layer and font
assets; an older pre-v4 application binary is not an appearance-safe rollback.
Do not delete the native engine until parity is verified.

## Dependency audit

Direct editor dependencies are exact-pinned in `package.json`/`package-lock.json`.
`npm ls` must show one Yjs, ProseMirror model/state/view and CodeMirror state/view.
MIT notices are retained in `packages/editor/THIRD_PARTY_NOTICES.md`.
The install audit reported two existing moderate development-test advisories
in Vitest/@vitest/mocker; no production editor advisory was reported. Do not apply
an unrelated major-version `npm audit fix --force` during the editor migration.
