# Editor and shortcuts

Write, Source and Read share one canonical Markdown document. Switching modes, changing appearance or rebinding keys does not reserialize it or create a new collaborative session. Editing commands apply source-range transactions; undo is local to the author, including table operations.

Development and production both default to Axiom's customized editor, built on
Milkdown/ProseMirror and CodeMirror. The older native engine requires an explicit
build-time rollback choice. It is not a separate user-facing product or the
production default. Ownership, verified coverage and remaining release gates are
tracked in [Editor vNext](EDITOR_VNEXT.md).

In Write mode, active prose keeps its editable inline Markdown. Headings retain
their typography and editable `#` markers. List structure stays rendered: complete
bullet/number/task prefixes are hidden while the item's body remains editable.
Complete images remain rendered until explicitly opened for in-document source
editing. Completed `> ` quote prefixes are hidden immediately while the body
remains literal inside a rendered quote.
A bare `>` or `>text` stays source-visible while active. Backspace at the start
of the quote body unwraps one level of that paragraph; later line boundaries join
without leaving stray prefixes. Undo restores the operation. Headings keep their H1–H6
font, size and weight while their real `#` markers remain visible and editable.
Leaving hides the syntax; deliberately returning the caret reveals the original source without changing
the heading's typography. Other items stay rendered. Read and export stay clean.
Enter creates a paragraph or the next list/task/quote item. Shift-Enter makes a
hard break except in single-line headings; Mod-Enter also makes a hard break
inside a list item. Enter on a terminal empty item leaves one nesting level.
Empty-container exits insert the required separators, so the next paragraph does
not become a lazy continuation of the preceding quote or list. Outside containers,
repeated Enter creates visible blank paragraphs. Code/math/table surfaces remain
specialized. There are no left insertion handles; optional folding guides and
right-margin reading actions have separate controls in Appearance → General.

Hover and right-click never enter source editing or move the typing caret.
Context actions inspect the clicked block; Escape restores the original caret.
Mac Control-click on non-link content follows the same rule. Commands recheck their
source-relative target after peer edits, and refuse stale or replaced blocks.

Clicking a task checkbox toggles completion without revealing its Markdown or
moving the writing caret/selection. Clicking the task's text still edits it.
Checkboxes support keyboard Space, shared updates and author-local undo; a
changed/replaced task marker or lost permission during activation is not overwritten.

## Quick access

`Mod` means Command on macOS and Control on Windows/Linux. Defaults:

| Action                                                | Shortcut                                      |
| ----------------------------------------------------- | --------------------------------------------- |
| Write / Source                                        | Mod-/; Mod-Shift-M remains an alias           |
| Command palette                                       | Mod-Shift-.                                   |
| Search notes                                          | Mod-K                                         |
| Shortcut settings                                     | Mod-Alt-/                                     |
| Find / replace in this note                           | Mod-F / Mod-Shift-F                           |
| Bold / italic                                         | Mod-B / Mod-I                                 |
| Strikethrough / highlight                             | Mod-Shift-X / Mod-Shift-H                     |
| Inline code / inline math                             | Mod-Shift-backtick / Mod-Shift-E              |
| Insert or edit link                                   | Mod-Alt-K                                     |
| Heading 1–6 / paragraph                               | Mod-Alt-1–6 / Mod-Alt-0                       |
| Bullet / numbered / task list                         | Mod-Alt-U / Mod-Alt-O / Mod-Alt-X             |
| Toggle task completion                                | Mod-Shift-Enter                               |
| Quote / code / display math / table                   | Mod-Alt-Q / Mod-Alt-C / Mod-Alt-B / Mod-Alt-T |
| Duplicate selection or block                          | Mod-Shift-D                                   |
| Move block up / down                                  | Alt-Up / Alt-Down                             |
| Indent / outdent                                      | Mod-] / Mod-[                                 |
| Break within a list item; continue after other blocks | Mod-Enter                                     |
| Copy selected Markdown (whole note if no selection)   | Mod-Alt-M                                     |
| Comment on selection                                  | Mod-Alt-Shift-M                               |
| Outline / focus mode                                  | Mod-Shift-L / F8                              |

The palette, contextual menus, optional toolbar and writing guide use the same registry as the keyboard handler. Right-click opens actions for the inspected block; Shift-F10 uses the current selection. Escape restores focus. Selecting prose shows a compact formatting palette. A persistent formatting bar is optional in Writing → General. Insertion offers theorem, proof, definition, lemma, research question, warning/note callouts, diagrams, citations, footnotes, equation references and linked notes. Tables open a size picker; attachments use the existing protected upload flow.

In Write or Source, type `/image`, `/attachment`, `/file` or `/upload` and choose **Image or attachment**. Select a ready Explorer file, or upload to the current space and then select it. Images embed; other files insert protected links pinned to that version. Cancel leaves the slash query unchanged. Selecting a file replaces the entire query in one undo step, follows non-overlapping peer edits, and refuses insertion if a peer replaced the query.

Command-click (Control-click on Windows/Linux) follows links without entering their Markdown or moving the caret. This also works on literal link text in the current visual paragraph and in Source mode. External HTTP/HTTPS links open a separate tab without opener access; note links, local headings and attachments keep their workspace navigation. Ordinary clicks still edit, right-click still opens editing actions, and unsafe URL schemes do not navigate.

Type `/` at an empty paragraph (also inside list/quote prefixes), then search by name or alias. Arrow keys navigate; Enter inserts; Escape dismisses without changing the query. A successful insertion is one undo step. Slash completion is suppressed in code, mathematics, tables and link syntax. Typed `[[`, `[@` and `\eqref{` offer note, citation and equation-label completion.

### Writing footnotes

In Write mode, type `[^id]:` and press Enter to open a quiet, titled footnote
container. Type normally inside it: paragraphs, lists, quotes, display equations,
code, tables and slash commands use the main editor. Markdown's header and
continuation indentation stay hidden. Existing definitions open the same way.
Clicking the ID title or following a footnote reference focuses the body; edit the
ID itself in Source mode. Hover and right-click never expose the whole definition.

Enter creates another body paragraph; Shift-Enter inserts a hard line break.
Enter on a final empty paragraph leaves the footnote. Nested lists and quotes
leave their own level first. Backspace at the start of an empty footnote returns
to just `[^id]:`; Enter reopens it, and another Backspace can delete the opener.
The first boundary of a nonempty footnote is protected from joining the preceding
document block. Source mode keeps exact Markdown, and undo and collaboration
continue to use the same document and history. The native rollback editor retains
its earlier source-backed definition surface.

### Footnote previews

Hover over a rendered footnote number for a formatted preview, including equations,
lists, code and tables. A short delay avoids flashes while moving the pointer.
The theme-matched card stays open while the pointer is over the number or card;
long contents scroll within it. Keyboard focus opens the same preview immediately.
Escape dismisses it without moving focus, and clicking the number or pressing
Enter still goes to its definition. Links inside the preview are read-only text;
follow them from the full definition. Source mode keeps literal Markdown.

Previews are document-scoped, update with collaborator changes and never create
source edits or undo entries. Opening a menu or switching documents closes the
preview; hovering does not dismiss existing editor tools. The current and rollback
editors, Read mode and standalone reading panes share the same behavior.

With structural continuation enabled, Enter inside a footnote definition creates
another indented paragraph; Shift-Enter creates a hard line break without leaving
the definition. Equation/code fences and nested lists/quotes retain that footnote
indentation. Enter on the final empty continuation leaves the footnote; an empty
nested list/quote exits its own container first. This works in Write and Source.
Ordinary wrapped text immediately after a definition's first line may omit
indentation. A blank separator or an unindented new block ends that lazy prose;
new paragraphs and display equations still need four spaces in imported Markdown.
For example:

```markdown
Result[^energy].

[^energy]: The total energy is:

    $$
    E = mc^2 + \frac{1}{2}mv^2
    $$

    This assumes a small velocity.
```

The editor inserts the continuation indentation while typing; `\[` and `\]`
also work. The entire definition, not just text after the colon, appears in its
rendered preview and footnote tooltip.

### TeX delimiters and equations inside quotes

STEM Markdown accepts both dollar and TeX-style delimiters:

- Inline: `$x+1$` or `\(x+1\)`.
- Display: `$$x=2$$` or `\[x=2\]`, on its own line.
- Multiline display: put `\[` and `\]` on separate lines around the TeX body,
  just as with `$$` fences. Type `\[` then Enter to generate the closing `\]`.

Authored delimiters remain unchanged in Source, collaboration and export.
Labels, references, previews and quoted/list equations use the same math engine.
Escaped backslashes and code remain literal; CommonMark/GFM parsing is unchanged.

In vNext, type `> $$` then Enter to start an equation inside a quote. Existing
quotes also support `/math`, Mod-Alt-B and the Display equation context action.
Edit the TeX without visible `>` prefixes; multiline typing, paste and snippets
preserve them in the shared source. Mod-Enter continues at the same quote depth.
An empty quoted paragraph followed by Enter exits one level.

```markdown
> The relation is
>
> $$
> E=mc^2\label{energy}
> $$
>
> Continue here.
```

Blank separators are optional. Nested quotes, research callouts and quoted list
items work too. One-line `> $$E=mc^2$$` is supported and expands to fenced form only
when a multiline edit needs it. Code and unfinished or mismatched fences stay
literal. A selection spanning different containers is not converted automatically.

## Live blocks

The active prose paragraph shows its inline Markdown, while list/task structure
and complete images stay rendered. Quotes hide completed `> ` prefixes only;
the remaining body and whitespace stay literal. Headings retain their configured
typography. Selection reveals endpoint prose; nested lists and quotes edit the
active leaf, not the whole container. An explicit Source-mode caret inside a quote
prefix can reveal that unit for literal marker editing. Source characters are never
silently decoded or moved. See [typing integrity](TYPING_INTEGRITY.md) for the full contract.

- **Lists:** type `- `, `* ` or a numbered prefix followed by a space to render its marker; a bare `-` or `*` does not trigger conversion. Task checkboxes remain interactive without exposing their source syntax. Enter creates the next item; Mod-Enter continues on a new line within the item. Enter on the last empty item exits its current level, stepping back to the parent in a nested list before leaving the group. Indent/outdent and empty Backspace act on that level and retain author-local undo. Focus, hover and context menus never expose a whole group's markers.
- **TOC, metadata and dividers:** a TOC block is a rendered section navigator, not a click-to-edit source surface. Dividers also stay rendered; Backspace/Delete removes a selected divider. Metadata uses a dedicated property table for supported YAML fields, with guarded commits. Nested or unsupported YAML stays lossless and can be edited in Source mode. None of these views rewrites the whole document.

- **Images:** left-click a complete image to reveal its Markdown as ordinary prose above the retained preview. For inline images, the sentence stays together above the selected preview. Quotes, lists, table cells and rich footnotes retain their containers. Edits synchronize immediately, with normal typing, Enter, clipboard and undo; there is no Apply button or source popup. Leaving collapses valid source; Escape keeps edits and selects the image for Backspace/Delete or arrow exit. Removing all source removes the preview. Incomplete syntax retains a visibly labeled last valid preview only while editing; leaving keeps the literal Markdown. Hover/right-click never reveal source; Enter/Space opens a keyboard-selected image. Right-click still offers explicit address, alt-text and title details. Same-address edits retain the loaded image element. Changed-address loading keeps the previous preview until the current request finishes; failed, disabled and unsafe states are clearly distinguished. Preview state never changes shared Markdown.
- **Mathematics:** click a rendered equation to edit LaTeX alongside a local MathJax preview. Invalid expressions retain their source and diagnostic; optionally keep the last valid preview, visibly marked stale. Type a backslash for Greek symbols and fraction, root, integral, sum, matrix, cases and aligned-equation snippets; Tab moves between fields. Escape leaves the construct; Mod-Enter continues after a display block. Typing `$$` then Enter creates paired delimiters. The equation menu copies TeX/SVG, adds or selects a label and inserts paragraphs. The workbench equation inspector searches TeX/labels, counts references and links to missing/duplicate-label warnings.
- **Code:** language, copy and overflow controls appear on hover/focus (touch exposes controls). Python, Julia and LaTeX are supported; unknown languages and blocks over 100 KB remain editable as plain code. Enter preserves indentation and can add an indentation level after opening constructs. Tab/Shift-Tab indent/outdent. First Mod-A selects code contents; second selects the document. Alt-Up/Down and Mod-Shift-D manipulate code lines without crossing fences; the contextual Block section operates on the whole block. Writing → Code sets wrapping/line-number defaults, independent of Source-mode appearance. Per-block display overrides and reset are view-only. Long unwrapped code scrolls within its block.
- **Tables:** edit directly in semantic table cells, with complete inline Markdown revealed in the active cell. Cells share the document surface and author-local undo; there is no nested editor. Tab/Shift-Tab navigate, optionally adding a row at the end. Enter moves to the next row; Shift-Enter inserts a safe `<br>`. Shift-click or Alt-Shift-arrows selects a rectangle. Copy/Clear operates on that rectangle; Delete clears without removing structure. In vNext, move near the right/bottom edge for a small add-column/add-row button; it targets that table even if your caret was elsewhere and focuses the new cell. The top-right hover toolbar offers alignment, TSV copy and more. More, right-click and Shift-F10 open one icon panel with Row/Column/Table tabs and explanatory tooltips. Arrow keys switch tabs; Escape restores the caret. Insert, duplicate, delete, move, alignment, select and clear commands retain source-based undo and peer-edit guards. Pointer-resize cell borders; double-click to reset local widths. Read-mode tables scroll within their own frame. Quoted TSV and sanitized HTML-table paste expand the grid in one undo step. Short rows gain missing cells only when edited. Header/final-column protections and LF/CRLF/unterminated-EOF preservation apply to structural edits.
- **Quotes and callouts:** styled while editing, with automatic continuation and empty-line exit. Exiting a nested prose quote inserts the required parent-depth separator so subsequent typing or paste remains in the parent, not a lazy continuation of the child. Repeated exits, quotes inside lists, LF/CRLF and peer edits retain the correct source and caret. Callouts have type/title controls. Source mode remains available for arbitrary syntax.

Tables remain Markdown tables, not spreadsheets: up to 100 columns and 1,000 rows, no merged cells, formulas or nested multiline blocks. Quoted tabs/newlines round-trip through TSV; only attribute-free `<br>` renders as a cell break. Other raw HTML remains inert. Code is not executed. Mathematics remains editable LaTeX, not a graphical equation builder or complete Typora compatibility layer.

Code-language autocomplete uses one research-first catalog for both the hover
language field and typed opening fences. Type three backticks (or tildes) to show
suggestions; continue typing to filter names or aliases such as `py`, `jl`, `c++`
and `tex`. Tab completes the first match; arrow keys select a match and Enter
accepts it. Completion fills only the language token, leaving the opener editable;
the next Enter opens the rich block. Without an explicit arrow-key selection,
Enter retains the normal block-creation behavior, including bare-fence defaults.
Clicking a suggestion also completes it. Escape dismisses without changing text.
The inline language field applies a clicked/keyboard-selected suggestion in one
undo step and returns focus to the code body. Clearing a label or entering a custom
language remains allowed. Closing fences, code bodies and math do not trigger
language suggestions; existing source, quote/list prefixes and CRLF are preserved.

**Code-body autocomplete and snippet expansion are disabled.** Typing keywords
or existing names does not open a suggestion menu, and Ctrl+Space does not request
one. Tab indents, Shift+Tab outdents and Enter inserts a newline. Syntax
highlighting, language-name autocomplete, math completion and collaboration
remain available. No stored notes or preferences are changed by this removal.

In the current WYSIWYG editor, deleting the final character from a code or math
input closes its specialized surface and reveals its Markdown in place, with the
caret retained. For blocks auto-completed by typing `$$`, `\[` or a code fence and Enter,
empty deletion returns to **only the authored opener**. It removes the generated
closing fence, untouched generated spacing and any automatically added default
language, while preserving an explicitly typed language and quote/list prefixes.
Changing or clearing the rich block's language field does not cancel this reversal:
a block started with a bare fence still returns to that bare fence. Suggestions
stay dismissed during the handoff and redo; fresh language typing can reopen them.
Enter opens the rich block again; further Backspace deletes the opener normally.
This is one undoable, shared Markdown edit, including deletion of the final body
character. Repeated creation/deletion does not accumulate blank paragraphs.
Imported, pasted, peer-edited or history-restored fences are not assumed to be
generated: they retain the lossless full-source handoff. For these blocks,
Backspace/Delete on an already empty input changes only local display state.
Whitespace still counts as content; merely opening an empty block never deletes it.

Inactive nested bullet/numbered/task lists and quotes are semantic elements in Write mode. Their active prose uses the source behavior above in vNext. Enter continues a list or quote, empty items exit/outdent, and Tab/Shift-Tab adjusts list depth with descendants. STEM mode additionally recognizes passive YAML front matter, `[toc]`, `~subscript~`, `^superscript^`, common emoji aliases and attribute-free `<u>underline</u>`. Metadata is never executed, and raw HTML stays inert.

The per-pane word counter stays outside the scrolling document. Open it for language-aware word/character counts, selection counts, reading time, equations, tables, code blocks and task totals. Share shows inherited team/project roles; copying a link does not grant access. Collaborator avatars jump to another session's location without moving your caret.

Code and TeX inside quotes or lists hide the surrounding Markdown prefixes while preserving them in source edits. Enter and multiline insertion continue the container; scoped Select All excludes its fences. Source-mode line navigation, TOC jumps and discussion anchors use the same source coordinates. Worker construction failures show an explicit warning; the native editor and synchronization remain usable, and unavailable statistics are never presented as fresh counts.

MathJax 4.1.3 and New Computer Modern SVG glyphs are bundled locally. AMS, mathtools and chemistry are available; physics requires an explicit `\require{physics}` in the document. Each expression gets fresh macro state. External packages, URLs, HTML styles and network-loaded fonts are disabled. Browser jobs have startup/execution deadlines and a bounded cache; HTML export uses an isolated memory/time-bounded worker (500 distinct equations, 20 MB equation output). Invalid expressions retain readable source. Axiom's Print/PDF action waits for previews; HTML contains embedded SVG, accessible MathML and CSS rather than a CDN dependency. The browser's native print shortcut cannot await asynchronous rendering; use the app action when equations are still loading.

## Personal settings and recovery

Open Personalize workspace for a routed settings center. Account, Appearance, Writing and Storage have dedicated categories. Appearance has exact numeric controls alongside sliders; Writing has General, Tables, Code, Mathematics and Keyboard shortcuts. Controls sit on the left of a resizable split, with a contextual **Try it here** scratchpad on the right and fixed Apply/Cancel actions. Write, Read and Source share the sample; hiding the preview preserves it. Preference drafts survive category changes; changing the sample category starts a fresh scratchpad. Apply saves the bundle; Cancel reverts it without leaving the page. Leaving with unsaved preferences offers Apply, Discard or Stay and returns to the prior workspace document. Keyboard shortcuts have platform-specific bindings, command/key search, a Customized only filter, recording, collision/reassignment choices, disable/reset and validated JSON import/export. Reserved browser/window keys and unmodified typing keys are rejected. The optional appearance restore point does not include editor preferences. See [settings behavior](SETTINGS.md) for resizing, navigation and account-form save boundaries.

Appearance and writing preferences synchronize atomically through `GET/PATCH /api/v1/me/preferences-bundle`, with both revisions checked in one transaction and one per-account local outbox. Writing schema v1 migrates to v2; outdated writers must reload (426). Independent offline/device edits merge field by field and command by command. Overlapping changes require a choice. Apply fails visibly if the durable local write cannot succeed. Shortcut availability still depends on operating-system/browser interception and keyboard layout; use the recorder to choose alternatives.

Typography includes the optional **LaTeX Article** preset: Latin Modern Roman,
19px prose, 1.65 line height, 70ch measure and 14px IBM Plex Mono code. It does not
change your interface font or colors. Theme includes **Paper Ink** and **Night
Paper**; all sixteen palettes remain independent of the five document styles.
Preview, Apply and Cancel work as before. Fonts are self-hosted; personal HTML
export embeds all four Latin Modern faces and their license for offline reading.
Standard exports do not adopt personal typography unless requested.

LaTeX Article also enables H1–H3 bottom rules, resting H1–H6 hierarchical section
labels (`§ 1`, `§ 1.1`, `§ 1.2`, `§ 2.1`) and
academic double-rule dividers. Typography → Document decorations controls these
independently of font/size adjustments. Other document presets turn them off.
Read, print and personal HTML use the same decoration stylesheet; source, TOC
labels and application headings remain unchanged.

In the current WYSIWYG editor, dividers stay rendered when clicked or focused.
There is no divider source field or hover toolbar. Clicking selects the complete
rule for direct Backspace/Delete removal; Undo restores its exact Markdown.
Use Source mode when you want to edit the original marker spelling.

Appearance schema v4 adds `documentDecorations: none | latex` and upgrades v1/v2/v3
profiles and pending local outboxes without resetting their values. Exact old
LaTeX Article preset matches gain decorations; other older custom looks stay plain.
Current clients send `X-Axiom-Appearance-Schema: 4`. Legacy GET requests receive a
representable v2/v3 record, or HTTP 426 when the current/previous appearance cannot be represented.
Legacy appearance PATCH requests receive 426 before any write. Writing remains
v2, portable palette files remain v1, and no database or Markdown migration is needed.

Table selections map through remote source changes. If a row/boundary is deleted, or a remote update competes with an uncommitted composition/title/language field, recoverable text is retained in a visible recovery panel rather than written into an unrelated location. Copy or download it, then dismiss it explicitly. Recovery is account-scoped and is cleared on sign-out. Clipboard operations require browser permission and a secure origin (localhost is supported).

If the Markdown preview worker cannot load, a visible warning explains how to reopen the note. Source editing and its local/server persistence remain available; a preview failure is not a save confirmation or a reason to clear browser storage.

This refinement needs no new database migration. It preserves note bodies/generations and existing preference rows until the user applies changes. Administrator backups include preferences. Group Markdown archives remain research-document exports, not account backups.
