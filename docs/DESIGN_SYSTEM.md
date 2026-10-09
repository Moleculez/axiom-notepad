# Axiom design criteria

The [brand guide](BRANDING.md) defines the shared connected-knowledge mark and
showcase identity. Application branding inherits semantic accent and radius
preferences; it must not impose fixed brand colors on document or account themes.
Use [theme authoring criteria](THEME_AUTHORING.md) for reviewed pack extensions.
The [shared UI contract](UI_CONTROLS.md) is required for control implementations,
numeric validation, action hierarchy, dialogs and screenshot acceptance.
Follow [localization criteria](LOCALIZATION.md) for whole messages, script
fallbacks, bidirectional chrome and source-preserving switches. Use logical
spacing/alignment; do not mirror scientific content or diagram geometry.

## Principles

The application should feel calm, legible, predictable and precise. App navigation answers where; the directory-style Explorer answers what belongs here; the inspector answers what is selected. Do not repeat navigation in all three surfaces.

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
user's choices. Appearance is v12; writing and portable palettes retain v2/v1.
Compiled theme packs add paired base palettes and scoped decoration without changing
user typography or geometry. See [Theme authoring](THEME_AUTHORING.md) for precedence,
validation, fixtures and the accessibility review contract. Paper Research,
Technical Slate, Botanical, Spectrum and Graphite Ink are opt-in; the default
look is unchanged.

The optional minimap is quiet navigation chrome in a separate paper-colored column,
not a second editable surface. Use the current document's font/color roles for its
miniature; keep labels and menus in UI type. Ordinary clicks, dragging and wheel
scrolling must preserve the editing selection and block state. Only explicit
cursor navigation may reveal a target. Share the reading-mark lane, keep the
footer fixed, and use the compact overview when a desktop pane is too narrow.
See [minimap](MINIMAP.md) for settings, accessibility and rendering boundaries.

Mind maps frame each node with an opaque paper surface, a thin neutral rule and
user-controlled compact radius. Quiet branch rails and stronger root/section
weights establish hierarchy; per-node shadows and nested content cards are not
part of this treatment. Reading/code fonts remain independent from UI captions.
Hover, selection, search and drop feedback change color or out-of-flow outlines,
never the measured border-box, padding or connector anchors. Selected ancestry
emphasizes rules without fading unrelated content below readable contrast.
Expanded fold controls appear on hover, selection or
keyboard focus; collapsed badges remain visible and count the entire hidden
subtree. Controls live in an unscaled screen layer and remain at least 32px even
when content is zoomed out. Bounded research previews retain mathematical output
and academic table rules; language/symbol icons are small caption aids, never
full-sized illustrations. Research previews render complete Mermaid diagrams and
host-permitted images at bounded size; attachments and compact/export media stay
summaries. Keep loaded image/diagram DOM through navigation and source-preserving
edits. Failed images have an accessible retry; invalid diagrams retain a clearly
labeled last-valid preview. Intrinsic node measurements exclude zoom, and camera
changes never rewrite math or diagrams.
Offline visual exports resolve the same paper/rule/radius/branch roles; node
frames and connections remain vectors even when labels are captured as pixels.
One auxiliary source/details pane owns scroll. Inspector tabs wrap as complete
controls at large text or a retained narrow width: never shrink a label into its
count, clip tab text or force a wider saved pane. Validate actual text-range
containment and spacing, not only button boxes. The host document footer shows map
counts alongside existing statistics, with no duplicate status footer. See
[mind maps](MINDMAP.md) for editing, navigation and acceptance boundaries.

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
- Quiet, purposeful input treatments; no heavy native outlines in normal themes. Keyboard focus uses a visible semantic inset ring or underline, with an outline fallback in forced colors. Never remove focus without a replacement.
- Native labels and accessible names, complete keyboard operation, visible error text, non-color-only state and touch-accessible actions. Icons use the existing Lucide family with consistent stroke/size.
- Menus/popovers stay within the viewport. Dialogs center in the viewport, scroll internally, trap/restore focus and dismiss with Escape unless doing so would discard unacknowledged destructive work.
- Confirm irrecoverable operations; prefer trash, recoverable drafts and guarded undo. No silent overwrite, silent permission expansion or fabricated progress.
- Stable skeleton geometry, informative empty states, contextual primary actions and inline retry. Errors that require action must not vanish in a timed toast.

## Layout

Top app navigation uses one context toolbar: history, breadcrumbs, a compact Recent
work switcher, search/commands, connection state, Inbox, transfers and account tools.
Do not reintroduce a tab strip or a second breadcrumb row. Keep formatting and
specialized reader/planning controls inside their pages.
The global command palette keeps a stable height and input position while results
change. Group headings, secondary location text and restrained type labels provide
hierarchy; the selected row is distinct without taking keyboard focus from the query.
Scope styles to this palette so editor command menus remain unaffected.
Creation belongs to Explorer/context menus, with note, canvas, math,
drawing and text as peers. Every route shares the same sidebar: Quick access
(including Audit and Trash), then Your workspaces. Group/account management stays
in Settings and workspace pages; there is no Administration section. Workspaces are
ownership-grouped peers; there is no separate Projects navigation product. Section
navigation belongs inside its page, never in a replacement sidebar. See
[file-first navigation](FILE_WORKBENCH.md).

Directory navigation + central workbench + at most one optional inspector. The sidebar starts with workspace roots; opening a workspace/folder lists its immediate children, with parent navigation and one overflow action per row, not an expanded file tree. Recent work replaces application tabs; the workbench supports up to two visible panes. Below two useful pane widths use a state-preserving pane switcher. Auxiliary panels become drawers before they crowd the document.

Time-zone fields use the shared `TimeZoneInput` editable combobox: runtime IANA
zone suggestions, city/region matching, current UTC offsets and typed-value
validation. Arrow keys navigate, Enter selects without submitting the form, Escape
closes suggestions, and Tab leaves normally. Reuse it rather than a partial static
list or unassisted text field.

Explorer lists default to a balanced density; compact/comfortable preferences remain available. Rows expose selection and a contextual action menu. Details that are not required for navigation belong in optional columns or the inspector.

Workspace section navigation stays inside the shared shell. Planning view tabs
share one filter row and one task inspector, rather than competing sidebars.
Gantt uses a single scrollport, aligned sticky labels, calendar shading and a
quiet today marker. Bars are keyboard-openable; date fields provide a non-drag
alternative. Dragging previews dates, never commits them. Schedule review states
the affected tasks and before/after dates, including dependencies outside the
current filter. Compact bars omit clipped text; full titles remain in row labels
and accessible names. Lists/timelines virtualize dense rows, not the editing
surface. Filters and scroll are view state, never task content. Drafts survive
navigation and stale background refreshes cannot overwrite them.

## Writing and preferences

Production and showcase use the same `TableOfContents` and right-hand
`ResizablePanel`, with no demo-specific outline drawing. Indent by actual heading
ancestry, not absolute heading level: the first H2/H3 can be a flush root and
skipped levels create no phantom parents. Branch collapse, active-section cues,
count and empty states share their implementation and stylesheet. Navigation and
resizing are view operations, never Markdown edits. Keep read-mode highlighting
aligned with settled document geometry after font/theme changes, not a stale
source-mode viewport. Preserve independent outline/document scrolling and the
fixed document footer.

Reading marks use a separate out-of-flow right margin and a quiet overview rail.
Hover previews are passive; clicking explicitly navigates or opens a card. One
pinned card fits beside the page or docks in the existing inspector—never squeeze
the document to fit a second inspector. The local annotation editor uses the same
engine and semantic typography, but has separate content/history and no shared
cursor. Keep privacy visible, secondary actions in icon-labeled menus, drafts
recoverable and document geometry unchanged. See [reading marks](READING_MARKS.md).

The document remains the primary surface. Selecting prose may reveal one small formatting palette; the persistent formatting bar is opt-in. Code and equation controls appear on hover or keyboard focus. Tables have square, paper-like horizontal rules with faint cell guides only while hovered, active or owned by a panel. The right and bottom edges reveal small add-column/add-row buttons. The top-right toolbar has alignment, TSV copy and more icons; more/right-click/Shift-F10 opens the same compact Row/Column/Table panel. Tooltips explain every icon and disabled reason. No long permanent strip of structural commands. Keep resize and append hit regions separate; reserve stable control space, including for the first block in a clipped viewport.

Use shared overlay ownership for pointer and keyboard menus; opening another dismisses the previous one. Text menus show shortcuts, while compact icon panels use labeled tabs and tooltips. Preserve the source selection while a menu is open, map its target through collaborative changes, and reject an action if the target disappears or is replaced. A table's overflow scroller must not clip its non-editable toolbar or popover. Escape restores its mapped caret; leaving releases editing focus. Clipboard actions fail visibly when permission is denied; mutations respect access roles, composition ownership and author-local undo.

Settings provide searchable Account, Appearance, Writing
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

Application controls use `components/ui/controls.tsx` and the canonical
`ui-controls.css` base: native Button/IconButton, Checkbox/Switch/Radio, Slider,
Field, ActionRow, HelpText and Notice. Routine guidance is unboxed; important
warnings remain recognizable. The eight trusted interface styles (Axiom, Contour,
Vector, Folio, Harbor, Signal, Gridwork and Cutline) share this geometry and state
contract while changing their component presentation. Do not reintroduce page-local
checkbox knobs, slider drawing or general button resets. `validate:ui` checks
the JSX boundary and narrow shared-action CSS drift; see
[control criteria](UI_CONTROLS.md) for usage and review.

Application fields have one visual shell. Shared SearchField/InputGroup own icon
tracks, surface and focus; Field owns the associated label, guidance and error.
Avoid nested bordered search boxes or page-local icon offsets. Use intrinsic
selector widths and non-shrinking short toolbar actions; wrap whole controls
instead of splitting labels like “Manage groups” into unintended lines.

## Original interface systems

The typed interface registry is the single source of identity, recipe and
comparison metadata. Styles change component **construction**, not only color,
radius or elevation. A palette, font or document pack is never a prerequisite for
recognizing the style. Production and showcase consume the same recipe and
presentation roles, including their outer shells and dialogs.

| System   | Chrome and hierarchy                                    | Fields and selection                                  |
| -------- | ------------------------------------------------------- | ----------------------------------------------------- |
| Axiom    | Balanced scientific workspace; restrained separators    | Quiet fields and understated selected rows            |
| Contour  | Broad tonal plates and softly grouped actions           | Tonal shells and solid selection plates               |
| Vector   | Architectural frames, edge rails and segmented chrome   | Outlined fields and leading-edge selection cues       |
| Folio    | Continuous paper, publication rules and flat overlays   | Straight ruled fields and underline selection         |
| Harbor   | Banded headers and recessed control groups              | Inset fields and coordinated grouped selection        |
| Signal   | Contrasting navigation and instrument-like compartments | Separated icon tracks and emphatic action edges       |
| Gridwork | Fine decorative lattice, brackets and precise rules     | Ruled field frames and bracketed selection            |
| Cutline  | Strong graphic edges and diagonal chrome accents        | Bold straight field edges and offset selected framing |

Every complete system covers actions, text/search/numeric fields, selectors,
checkboxes/switches/radios/sliders, tabs, menus, dialogs, navigation, item rows and
inspector chrome. Use one implementation of native control semantics and geometry;
bound styling through the shared recipe. No page-local field reset or competing
button/dialog theme is allowed. New recipes require the same full coverage, not a
single attractive specimen.

Decorative patterns and graphic cuts are chrome-only. Never place a lattice,
hatch, blur or per-layer shadow behind prose, equations, code, PDFs, data tables
or editable fields. A stronger decorative edge does not change a hit target or
the measured control box. Hover, focus, pending and selection preserve geometry.

User radius, shadows, density, font size, motion, contrast and transparency always
win. Zero radius stays square except functional circular indicators; no-shadow
preferences keep focus/selection indicators. Forced colors retain visible system
state cues; reduced transparency uses opaque surfaces. Treat these overrides as a
final layer rather than duplicating them in each style.

Review the same fixture with identical palette and fonts. Each pair must differ
in at least three non-color treatments, including fields or selection. The
comparison gallery displays real components; miniature cards must show the
style's distinguishing field/chrome/selection behavior, not abstract color bars.
Recognizability does not justify changing navigation, source, scroll ownership,
authorization, document layout or saved preferences.

Mixed application action groups opt into `ActionRow size="standard"` or
`size="compact"` for one text-scaled control edge, not per-page fixed pixel
heights. An omitted size keeps the existing standalone/contextual treatment,
including inside an unsized nested row. Planning clause Remove actions belong
beside their field under the full label, not in an extra auto-fit grid column.
Use `--field-width` and intrinsic flex tracks for short filters; wrap complete
controls at constrained widths. Check both border-box edges and icon/text
centers, not just the surrounding row. Keyboard focus on scrollable tabs must
stay visible inside first/last edges while retaining the separator. Application
read-only styling also excludes `data-editor-field`; document fields never acquire
a filled application surface when their editability changes.

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
link definitions use the same property table, and bibliography entries align with the document
column under one divider. TOC and divider blocks never reveal source on click.
Context field dialogs preserve local drafts on conflicting peer edits or permission
changes. Derived previews and display-only resizing must never write to the shared
Markdown document. See [Editor vNext](EDITOR_VNEXT.md) for its current release gates.

Property tables have one quiet caption, a shared key column, subtle horizontal
rules and no surrounding card, shadow or filled key column. Fields stay text-like
and transparent through hover/focus, remain native inputs throughout editing, and
match ordinary document-table typography and padding. Only captions use UI type.
The cell owns a square focus/error outline; no input fill, underline, rounded
corner or shadow may appear. Long labels get more column space at enlarged text
sizes; multiline values grow within a bounded cell. Caption actions appear on
hover or keyboard focus in reserved space. Routine editing instructions are
screen-reader descriptions, not a permanent footer. Validation remains inline
beside the field until corrected or cancelled. Read mode uses the same metadata
table typography; link definitions remain invisible in rendered reading output.

Treat the editor as one continuous sheet. Embedded code and TeX source, gutters,
equation previews and contextual toolbars inherit the host surface through
transparent layers, including tinted canvas cards. Differentiate code with its
font and syntax, not a second panel. Keep selection/search/peer highlights and
optional active-line feedback. Document fields opt out of application form rules
with `data-editor-field`; settings/dialog/search controls remain application chrome.
`app/styles.ts` supplies the complete cascade to both app and editor lab.

Native editing uses semantic list, quote, table and code elements with the same font and color roles as reading. Nesting must be visible without decorative guide-line clutter. Tables fill their available frame; wide cells and code scroll within the block. Revealing source markers or block controls must not create a second competing visual theme.

vNext's active ordinary prose unit reveals its inline source. Headings retain H1–H6 typography with real editable hashes. Completed list/task markers always remain rendered; only their body is editable, including nested items. `> ` immediately displays a quote rail and hides only completed quote prefixes; the body remains literal while active. Bare/unspaced markers remain editable source. Quote and list body text stays inside its container, with no negative source-marker margin. Enter creates a sibling item, Mod+Enter breaks a line inside it, and Enter on an empty item exits one nesting level. Inactive units render normally; the native rollback editor retains its earlier caret-local reveal. Selection dragging and IME must not trigger mid-gesture layout changes. Active table cells retain the grid and reveal inline syntax locally. Code uses a flat square source surface; equations and their TeX editing fields remain unboxed on the host sheet. Their controls sit above the top-right corner on hover/focus, with matching Write/Read font roles. Existing source blank lines get mapped paragraph geometry, never invented Markdown. See [typing integrity](TYPING_INTEGRITY.md).

Workspace and file context menus use the editor's portal, spacing, typography, focus treatment and danger tokens. Pointer and keyboard actions share the same registry as item inspectors. F2, copy/cut/paste, Delete and Shift-F10 are scoped to Explorer focus; they never steal text-editing shortcuts. A right-click on a selected row targets the whole selection; another row becomes the sole target. Partial failures retain failed targets and offer an explicit retry. Archived workspaces move out of directory navigation into Manage workspaces; Trash never expires automatically.

Shared context menus are normalized by `lib/menu-model.ts`: at most eight root
rows, one submenu level, and no section headings repeating the action labels.
Use explicit categories for long menus; nested legacy categories flatten with a
short parent label. `hidden` removes inapplicable actions; temporary constraints
use `disabled` plus `disabledReason`. Preserve all authorized actions and existing
mutation handlers. Danger actions stay last and separated. Arrow Right/Left opens
and leaves a submenu; Escape steps back before dismissing and restoring focus.

Document viewers use semantic app colors for chrome. An XLSX cell grid preserves
basic document colors on a light canvas, like PDF pages; document-provided colors
are not new application theme tokens. Toolbar labels and compact inputs explicitly
override general form stacking/width rules. Reading panes scroll independently;
formula/status bars and sheet navigation remain outside the viewport.

Each document pane owns its scroll area and a footer outside that area. Statistics open in a viewport-contained panel, not a card clipped by the document. At narrow widths the inspector starts closed and opens only on request. Presence colors supplement collaborator names; another device for the same account remains a distinct session. Share describes actual inherited permissions and never implies that copying a link grants access.

Standalone authorization screens use one shared-recipe frame with stationary
identity/header and decision/footer bands; only the access details and bounded
workspace picker scroll. Align native checkboxes beside the first line of their
labels, with enough room for long names and descriptions. Never inherit ordinary
form-label column stacking into a consent choice. Keep the trust/content-sharing
notice visible with Allow/Deny, disclose requested account/session permissions,
and retain explicit selections through search and failed submissions. Pending
decisions lock the choices without changing action geometry. Client identities
and URLs wrap as readable text, not remotely loaded branding or preview content.

## Review checklist

Extensions never define a competing interface. Their native inspector, settings
directory and dialogs follow the [control contract](UI_CONTROLS.md#extension-and-inspector-ui)
and [extension boundary](EXTENSIONS.md). One explicit owner chooses the auxiliary
inspector; inactive panes retain draft state without drawing another sidebar.
File/workspace cards show readable access labels and ordinary item/storage metadata,
not raw roles or JSON. Background work opens authoritative existing controllers,
not another queue or an automatic retry action.

For the current desktop phase, check Frost/Graphite and custom themes; large fonts; long names; empty, loading and denied states; keyboard-only interaction; reduced motion; and forced colors. Mobile layout development and device certification are deferred. Text contrast target is 4.5:1 and essential control/focus contrast 3:1. Test overflow within tables/math/code rather than allowing whole-page horizontal scrolling.

Inspect actual screenshots as well as passing interaction assertions: footer visibility, label/control alignment, pointer hit regions and comfortable mathematical spacing need their own geometry checks.
