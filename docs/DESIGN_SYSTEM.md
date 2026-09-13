# Axiom design criteria

The [brand guide](BRANDING.md) defines the shared connected-knowledge mark and
showcase identity. Application branding inherits semantic accent and radius
preferences; it must not impose fixed brand colors on document or account themes.
Use [theme authoring criteria](THEME_AUTHORING.md) for reviewed pack extensions.

## Principles

The application should feel calm, legible, predictable and precise. App navigation answers where; the Explorer tree answers what belongs where; the inspector answers what is selected. Do not repeat navigation in all three surfaces.

Content is the strongest visual layer. Glass belongs to restrained chrome; reading, code, PDFs, forms and data surfaces remain opaque. Color communicates purpose, not decoration. Retain all existing personal appearance and accessibility preferences.

The [visual viewer](VISUAL_VIEWER.md) uses the UI font, semantic surfaces and the
shared dialog shell. Its inspection canvas can use explicit white/dark/checker
backdrops independently of the app theme; these are analysis controls, not new
palettes. Image markup stays inside that viewer; documents show only a quiet count.

## Tokens

- Typography: system sans-serif interface/headings, Source Sans 3 reading, JetBrains Mono code. Defaults 15/18/14 px respectively, expressed in relative units and overridden by the existing semantic font preferences. Reading line-height 1.75; reading measure is independently adjustable. Inter remains an optional interface family.
- Space: 4, 8, 12, 16, 24, 32 and 48 px; scale controls with text rather than fixing their content height.
- Shape: derive all chrome from the account radius (12 px by default): controls 1×, compact controls 0.5×, panels/cards 1.35×, windows/dialogs 1.8×. A zero radius remains square; functional circular indicators stay circular.
- Color: existing semantic background, surface, paper, text, muted, line, accent, focus and status tokens; never hardcode a component's theme.
- Elevation: flat content, one restrained popover elevation, one dialog elevation. Avoid multiple nested shadows and floating toolbars.
- Motion: brief 120/180 ms opacity and color transitions; never animate layout while typing. Honor reduced motion, forced colors and reduced transparency.

Document typography must be scoped to both Write and Read surfaces. Generic app
heading/paragraph rules must not override reading fonts, heading scales, line
height or paragraph spacing. Conversely, a document style must not change settings
headings or navigation fonts. Test both directions, not only saved preference values.

Internal note links use a small decorative note icon, a quiet accent tint and an
underline in both Write and Read. Unresolved references have a dashed underline
and an explanatory title, not a color-only warning. Keep the document font and
baseline, allow long aliases to wrap, respect zero radius and avoid layout changes
on hover. Center the note icon in the first line's font box, not a fixed
top offset or the whole multiline link. Icons are CSS decoration, never Markdown,
copied label text or extra editable nodes. Retain normal link navigation/editing,
visible keyboard focus and forced-color/reduced-motion support; print omits the
icon and background.

The sixteen coordinated palettes use the same semantic roles. Pearl/Carbon are
neutral with ink/violet accents; Ivory/Espresso emphasize warm paper; Mist/Deep Sea
use mineral/teal tones. Paper Ink and Night Paper offer restrained research-document
colors. Modern, Journal, Compact Research, Accessible and LaTeX Article are optional
document-only typography presets, not separate component themes. Colors and document
fonts are independent. Defaults are unchanged; never silently apply a preset.

LaTeX Article uses self-hosted Latin Modern Roman (regular, italic, bold and bold
italic), local CJK fallbacks, 19px prose, 1.65 line height, 70ch measure, 0.8em
paragraph spacing and 14px IBM Plex Mono code. Its heading scale is 0.9. Keep
the interface in its chosen UI face. Do not simulate paper pagination or justify
paragraphs; retain reflow, readable spacing and selectable mathematical output.
New font IDs require schema compatibility, not fallback settings that erase a
user's choices. Appearance is v8; writing and portable palettes retain v2/v1.
Compiled theme packs add paired base palettes and scoped decoration without changing
user typography or geometry. See [Theme authoring](THEME_AUTHORING.md) for precedence,
validation, fixtures and the accessibility review contract. Paper Research and
Technical Slate are opt-in; the default look is unchanged.

The optional minimap is quiet navigation chrome in a separate paper-colored column,
not a second editable surface. Use the current document's font/color roles for its
miniature; keep labels and menus in UI type. Ordinary clicks, dragging and wheel
scrolling must preserve the editing selection and block state. Only explicit
cursor navigation may reveal a target. Share the reading-mark lane, keep the
footer fixed, and use the compact overview when a desktop pane is too narrow.
See [minimap](MINIMAP.md) for settings, accessibility and rendering boundaries.

LaTeX Article enables personal document decorations: H1–H3 have bottom rules,
resting H1–H6 have a muted hierarchical label (`§ 1`, `§ 1.1`, `§ 1.2`, `§ 2.1`)
in a reserved left gutter that grows with the number, and authored
dividers have a 1.5px primary rule, 4px gap and 1px companion rule. Active headings
keep their rules and editable source markers, without a generated section sign.
Number actual heading ancestry, like the outline: a note beginning at H2 starts
at 1, and skipped levels never generate zero-valued parents. Recompute from the
canonical document after heading edits, moves and collaboration updates.
Decorations never enter source, clipboard, accessible names, TOC labels or IDs.
They are absent from app headings, export title chrome and footnote separators.
Typography's Document decorations control is independent of individual fonts,
sizes, spacing and colors; another document preset resets it to that preset's look.

## Interaction contract

- Every interactive element has resting, hover, keyboard focus, pressed/selected and disabled states. Mutations also expose pending/success/error/recovery states.
- Quiet filled or borderless inputs; no heavy native outlines in normal themes. Keyboard focus uses a visible semantic inset ring or underline, with an outline fallback in forced colors. Never remove focus without a replacement.
- Native labels and accessible names, complete keyboard operation, visible error text, non-color-only state and touch-accessible actions. Icons use the existing Lucide family with consistent stroke/size.
- Menus/popovers stay within the viewport. Dialogs center in the viewport, scroll internally, trap/restore focus and dismiss with Escape unless doing so would discard unacknowledged destructive work.
- Confirm irrecoverable operations; prefer trash, recoverable drafts and guarded undo. No silent overwrite, silent permission expansion or fabricated progress.
- Stable skeleton geometry, informative empty states, contextual primary actions and inline retry. Errors that require action must not vanish in a timed toast.

## Layout

Top app navigation uses resource tabs, a pages launcher, search and account tools.
Creation belongs to Explorer/New Tab/context menus, with note, canvas, math,
drawing and text as peers. Every route shares the same sidebar: Quick access,
Your spaces, then Administration (Workspaces, Groups, Audit, Trash). Section
navigation belongs inside its page, never in a replacement sidebar. See
[file-first navigation](FILE_WORKBENCH.md).

Context tree + central workbench + at most one optional inspector. Trees use actual depth indentation and one overflow action per row. The workbench supports resource tabs and up to two visible panes; below two useful pane widths use a state-preserving pane switcher. Auxiliary panels become drawers before they crowd the document.

Explorer lists default to a balanced density; compact/comfortable preferences remain available. Rows expose selection and a contextual action menu. Details that are not required for navigation belong in optional columns or the inspector.

## Writing and preferences

Reading marks use a separate out-of-flow right margin and a quiet overview rail.
Hover previews are passive; clicking explicitly navigates or opens a card. One
pinned card fits beside the page or docks in the existing inspector—never squeeze
the document to fit a second inspector. The local annotation editor uses the same
engine and semantic typography, but has separate content/history and no shared
cursor. Keep privacy visible, secondary actions in icon-labeled menus, drafts
recoverable and document geometry unchanged. See [reading marks](READING_MARKS.md).

The document remains the primary surface. Selecting prose may reveal one small formatting palette; the persistent formatting bar is opt-in. Code and equation controls appear on hover or keyboard focus. Tables have square, paper-like horizontal rules with faint cell guides only while hovered, active or owned by a panel. The right and bottom edges reveal small add-column/add-row buttons. The top-right toolbar has alignment, TSV copy and more icons; more/right-click/Shift-F10 opens the same compact Row/Column/Table panel. Tooltips explain every icon and disabled reason. No long permanent strip of structural commands. Keep resize and append hit regions separate; reserve stable control space, including for the first block in a clipped viewport.

Use shared overlay ownership for pointer and keyboard menus; opening another dismisses the previous one. Text menus show shortcuts, while compact icon panels use labeled tabs and tooltips. Preserve the source selection while a menu is open, map its target through collaborative changes, and reject an action if the target disappears or is replaced. A table's overflow scroller must not clip its non-editable toolbar or popover. Escape restores its mapped caret; leaving releases editing focus. Clipboard actions fail visibly when permission is denied; mutations respect access roles, composition ownership and author-local undo.

Settings keep the shared tree and provide searchable Account, Appearance, Writing
and Storage categories inside the page. Switching categories or visiting another
app tab retains the current draft. Live preview is distinct from Apply; Cancel
restores applied values. Keep Apply/Cancel fully inside the viewport. Precision
fields supplement sliders, and writing previews demonstrate affected behavior.

Appearance and Writing pair left-hand fields with a right-hand scratchpad in a
resizable split. Give each pane its own scroller and keep the shared actions
outside both. Resizing must support pointer and keyboard input, with a visible
focus state and a reset. Hiding a preview must not erase experimental text.
Use opaque reading surfaces, restrained separators, consistent compact toolbars
and interface fonts for controls; document typography belongs only in the sample.

Each panel frame belongs to a stationary outer container, not the scrolling
settings card. Match the frames' top/bottom edges, radius and border token; inset
the content and reserve focus space. Inner sections use spacing and dividers.
The persistent Try it here toolbar owns Writing/Interface and contextual writing
actions, with no additional tab strip. Keep both samples mounted when switching.

Shared chrome tokens live in `appearance.css`, including `--size-ui-small`,
`--size-ui-caption`, `--control-radius-small` and `--panel-padding`; isolated
editors use them too. Use minimum, text-scaled control heights instead of fixed
content heights. Radius zero and shadows None remain effective; selection and
keyboard-focus rings are functional indicators, not decorative elevation.
Use the canonical `--line`, `--paper` and `--accent-bg` roles directly, not
component-local aliases that disappear when a preview moves to another host.

Canvas headers/content/captions form a flexible column. Only card content clips;
ports, resize handles and selection rings stay outside that clip. Auto-height
measures real header/caption dimensions in unscaled canvas coordinates, and
reading/editing share content insets. Editor table/code/math controls similarly
reserve text-scaled space even before hover, including for the first block.
Explorer selection actions occupy the same grid slot as the ordinary toolbar;
both contribute intrinsic height so large text cannot cover adjacent content.

Account forms group related fields, show limits and save state, and provide a
form-local Cancel. Disable unchanged or invalid submissions and retain failed
drafts. If a preference draft remains while viewing Account, place its explicitly
named actions in a separate top notice rather than a second competing footer.
Navigation/field searches need clear buttons and useful empty states. See the
[settings interaction contract](SETTINGS.md).

Use the same mathematical renderer in editing, reading and exports. A stale equation must be explicitly labeled, never silently presented as the current result. TeX errors do not remove source. Equation numbers, reference diagnostics and source navigation belong in the optional document inspector, avoiding more permanent editor chrome.

Structural previews identify their source purpose without repeating labels:
metadata uses a quiet property/value table, TOC uses a static section navigator,
definitions show their key, and bibliography entries align with the document
column under one divider. TOC and divider blocks never reveal source on click.
Context field dialogs preserve local drafts on conflicting peer edits or permission
changes. Derived previews and display-only resizing must never write to the shared
Markdown document. See [Editor vNext](EDITOR_VNEXT.md) for its current release gates.

Native editing uses semantic list, quote, table and code elements with the same font and color roles as reading. Nesting must be visible without decorative guide-line clutter. Tables fill their available frame; wide cells and code scroll within the block. Revealing source markers or block controls must not create a second competing visual theme.

vNext's active ordinary prose unit reveals its inline source. Headings retain H1–H6 typography with real editable hashes. Completed list/task markers always remain rendered; only their body is editable, including nested items. `> ` immediately displays a quote rail and hides only completed quote prefixes; the body remains literal while active. Bare/unspaced markers remain editable source. Quote and list body text stays inside its container, with no negative source-marker margin. Enter creates a sibling item, Mod+Enter breaks a line inside it, and Enter on an empty item exits one nesting level. Inactive units render normally; the native rollback editor retains its earlier caret-local reveal. Selection dragging and IME must not trigger mid-gesture layout changes. Active table cells retain the grid and reveal inline syntax locally. Code uses a flat square source surface; equations are unboxed on paper, with a separated TeX surface during editing. Their controls sit above the top-right corner on hover/focus, with matching Write/Read font roles. Existing source blank lines get mapped paragraph geometry, never invented Markdown. See [typing integrity](TYPING_INTEGRITY.md).

Workspace and file context menus use the editor's portal, spacing, typography, focus treatment and danger tokens. Pointer and keyboard actions share the same registry as item inspectors. F2, copy/cut/paste, Delete and Shift-F10 are scoped to Explorer focus; they never steal text-editing shortcuts. A right-click on a selected row targets the whole selection; another row becomes the sole target. Partial failures retain failed targets and offer an explicit retry. Archived workspaces move out of the navigation tree into Manage workspaces; Trash never expires automatically.

Each document pane owns its scroll area and a footer outside that area. Statistics open in a viewport-contained panel, not a card clipped by the document. At narrow widths the inspector starts closed and opens only on request. Presence colors supplement collaborator names; another device for the same account remains a distinct session. Share describes actual inherited permissions and never implies that copying a link grants access.

## Review checklist

For the current desktop phase, check Frost/Graphite and custom themes; large fonts; long names; empty, loading and denied states; keyboard-only interaction; reduced motion; and forced colors. Mobile layout development and device certification are deferred. Text contrast target is 4.5:1 and essential control/focus contrast 3:1. Test overflow within tables/math/code rather than allowing whole-page horizontal scrolling.

Inspect actual screenshots as well as passing interaction assertions: footer visibility, label/control alignment, pointer hit regions and comfortable mathematical spacing need their own geometry checks.
