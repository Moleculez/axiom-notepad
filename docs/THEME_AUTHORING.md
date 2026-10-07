# Trusted theme packs · contract v1

Theme packs are reviewed source code compiled into Axiom, not uploaded plugins.
The [extension API](EXTENSIONS.md) accepts only declarative native panel data.
Imported extensions cannot supply theme selectors, fonts, controls or arbitrary
HTML. Their panels, permission/review dialogs and activity views inherit the
same host tokens, radius, shadow, motion, contrast and typography preferences.
The JSON palette importer remains color-only (`axiom-theme`, v1). It never accepts
CSS, HTML, JavaScript, font URLs, or executable expressions. A saved pack ID only
selects an entry in the static registry; it never becomes a filesystem/import URL.

The connected-knowledge logo is a shared component, not a pack-specific drawing.
It follows semantic accent/on-accent colors and radius. Packs must retain its
geometry, accessible naming and focus behavior; see [brand criteria](BRANDING.md).
Do not replace it with an upstream editor mark or add a remote font for lettering.

## Authoring a pack

Mind-map presentation inherits existing paper/text/accent, interface and reading
font/size tokens. Branch colors must use semantic theme values, not a separate
hardcoded palette. Layout/spacing/width preferences are independent of palettes
and fonts. Label/source fields keep `data-editor-field` transparency; selection,
drop targets and folding must retain keyboard/forced-color visibility. Base mind
maps now frame each node with paper, a neutral one-pixel border, a restrained
semantic branch rail and the user's compact radius. Packs must not add per-node
shadows, nested frames, global form resets or animation that overrides motion
preferences. Production and showcase share the same native surface. See
[mind-map contributor contracts](MINDMAP.md#contributor-and-acceptance-contracts).
Research/compact previews, focus, folds, camera and the optional overview are view
state, not theme mutations. Keep code/table preview surfaces transparent and
equations stable during navigation. Fold/draft controls use unscaled shared
control geometry; their sizes must not shrink with map zoom. Test caption icons,
task controls, source resize handles and the single host footer with large text,
square corners, no shadows, reduced motion and both color modes.
Mermaid previews reuse the document renderer and semantic paper/text/accent/rule
colors. Palette/font changes refresh their SVG without resetting the camera;
navigation does not repaint it. Authored images keep their original colors, fit
bounded node geometry and follow host asset/URL policy. Theme packs must not add
remote resources, media filters or a competing image/diagram frame.
Node hover/search/lens/selection only strengthen existing rules or out-of-flow
outlines; connector anchors continue to use the same measured border-box. Keep
radius zero square, all content legible in forced colors and unselected content
at ordinary contrast. Offline exporters resolve theme tokens before writing
surface/border/radius/branch colors; theme CSS never becomes an exported script.

### Interface styles and public website templates

Appearance schema 12 separates `interfaceStyle` from `themePack`. Eight original
systems—Axiom, Contour, Vector, Folio, Harbor, Signal, Gridwork and Cutline—use
the typed recipe registry in `packages/shared/src/interface-styles.ts`.
Production and showcase share identities, bounded presentation roles and
representative control miniatures. Rendering stays in the shared control/style
owners; these are compiled source recipes, never uploaded CSS.

The schema upgrade maps known historical identities into their successor families
while preserving unrelated preferences and restore points. Legacy reads return
only representable styles/packs; an unsupported selection gets an upgrade response,
never an unknown ID or silent style replacement. Current-schema writes remain
mandatory, including the bundled preference API, so an old tab cannot erase a new
choice. The first-paint loader uses registry-derived identities and aliases.

Every recipe covers fields, controls, selection, chrome and overlays and differs
in at least three non-color treatments from every other recipe, including fields
or selection. See the [design matrix](DESIGN_SYSTEM.md#original-interface-systems).
Geometry, native semantics and the single-sheet editor boundary remain shared.
Recipe variables use semantic palette, radius and shadow tokens. A zero-radius,
no-shadow, high-contrast, reduced-transparency or reduced-motion user choice still
wins through the final accessibility/preference layer. UI, prose and equation fonts
remain independent. Grids, diagonal accents and instrument-like decoration belong
only to chrome, never reading, editable fields or data.

Do not use an interface style to alter scrolling, dialog portals, toolbar hit
areas, editor geometry or authorization. Review settings, menus, dialogs, file
lists and the Interface specimen in every style; avoid specificity conflicts with
old page-local styles. Settings navigation is a vertical rail, not a second row
of pills, and scrollable content sits inside stationary panel frames.

Control drawing has one owner, `app/ui-controls.css`. Consume `--control-surface`,
`--control-edge`, `--control-hover`, `--control-selected`, shape and slider/switch
presentation roles in trusted base styles; never duplicate an input/knob reset
in each page. Style variables are inherited from `html[data-interface-style]`,
including portal dialogs and the static showcase. `--on-danger` is derived for
solid destructive labels independently of `--on-accent`; do not substitute paper
or fixed white. Shared native controls, unboxed HelpText, consequential Notice,
pending geometry and keyboard states are governed by [UI controls](UI_CONTROLS.md).
The registry supplies every presentation role, including field edges/inset rules,
adornment compartments, header foregrounds, navigation and overlay treatments.
`--ui-header-text`/`--ui-header-muted` and `--ui-chrome-text`/`--ui-chrome-muted`
are not substitutes for body `--text`/`--muted`. Inverse chrome derives a legible
foreground without changing the selected palette. Keep structural inset rules
separate from optional `--shadow`, so Shadows None retains selection and framing.
An underlined field still reserves the common border box; hover, invalid and focus
must never change measured edges or clip an icon track.
Application text fields additionally consume `--field-surface` and `--field-edge`.
Use TextInput/TextArea/NativeSelect/SearchField/Picker rather than a page-local
native reset. Document-editing fields retain `data-editor-field` and their
single-sheet treatment. Search icons belong inside SearchField; asynchronous
entity popups remain owned by the parent dialog rather than a second portal.
InputGroup owns decorative prefixes and trailing actions as one surface; Field
owns the linked label above it. Never add a second border around SearchField or
position its icon with page-local offsets. Layout uses wrapperClassName and
`--field-width`; prominent search may adjust the shared text/height roles without
redrawing the control. See the icon-field geometry checklist in UI controls.

Mixed application toolbars opt into the shared ActionRow standard/compact sizing
context; interface styles and palette packs must not override its height, field
padding, clear-action inset or wrapping. Unsized groups retain their standalone
control treatment and establish a separate context when nested. Keep contextual
editor controls, native selectors and property-table inputs under their existing
owners rather than applying one toolbar size everywhere. Read-only document
fields remain transparent. The shared Interface specimen includes both mixed
toolbar sizes; review their resolved edges and clear-action containment with
large UI text, zero radius and no shadows. Scrollable page tabs retain an inset
focus cue at clipped edges, including in forced colors; packs cannot erase it.

Public website templates are a third, separate layer under `apps/publish/client`.
They must work without the private app shell or preference stores, use only
selected public resources and locally bundled licensed assets, and preserve
print/readability, keyboard navigation and light/dark behavior. Template choices
are saved in a website draft and take effect publicly only after reviewed release.
See [publication boundaries](WORKSPACE_WEBSITES.md).

Publication theme IDs/defaults are defined in `packages/shared/src/site-design.ts`.
Keep `design.theme` (component treatment) separate from `design.template` (homepage
layout), reading preferences and palette mode. Old saved configurations default to
`classic`; only newly created websites start at `latex-paper`. Public theme selectors
are scoped to `data-site-theme`. Reading overrides use `--article-font-size`,
`--article-leading` and `--article-measure`; color tokens remain semantic. A theme
must not hide privacy settings, change publication permissions or load remote fonts.

The designer specimen and releases both use `siteDocument`, `publicMarkdown` and
the independently built `apps/publish/client/{site,experience}.css`. Do not implement
a second mock renderer. LaTeX Paper/Monograph use pinned `latex.css` Latin Modern
webfonts only, not its global stylesheet. The bundle carries its MIT notice, the
GUST font license and LPPL text. Sources: [LaTeX.css](https://latex.vercel.app/) and
[Tufte CSS](https://edwardtufte.github.io/tufte-css/). Preserve attribution when
adding or redistributing font assets. Verify article, TOC, archive, table, math,
footnotes, dark mode and print in each theme before adding an ID.

### Palette pack workflow

1. Add a typed manifest to `packages/shared/src/theme-packs.ts` and register its ID
   in `themePackIds`. Use `format: "axiom-theme-pack"`, `version: 1`, and
   `minimumAppearanceSchema: 12` for new packs (the two original packs retain 5).
   Include name, description, author, license,
   stylesheet path, asset inventory, and at least one fixture path.
2. Supply complete light **and** dark palettes using the existing 21 semantic
   roles. Literal six-digit hex values belong here, not in component styles.
3. Add the stylesheet to `apps/web/themes/` and explicitly import it in the root
   layout. Every selector must begin with `[data-theme-pack="your-id"]`.
4. Use the existing UI/prose/heading/code font roles. Reuse licensed self-hosted
   fonts; new font assets require a reviewed base application change, provenance,
   license files, fallback stacks, and offline/export testing. Packs cannot load
   remote assets. Keep assets in the manifest even when used by base components.
5. Run `npm run validate:themes`, `npm run validate:ui`, typecheck, unit tests, and browser acceptance.
   Preview the pack in Settings → Appearance → Theme. The right panel offers both
   the real writing scratchpad and an interactive Interface specimen.

Example selector:

```css
[data-theme-pack="your-id"] .canvas-card-toolbar {
  background-color: var(--paper);
  color: var(--muted);
}
[data-theme-pack="your-id"]
  .canvas-card:where(:not(.is-selected, .is-editing, .is-connection-target)) {
  box-shadow: var(--shadow);
}
```

The validator uses a CSS parser and selector AST, not a text-prefix-only check.
It rejects unscoped selector lists, at-rules, URL loads, `!important`, selectors
crossing document/security boundaries, layout properties, and literal component
colors. `font-family`, `font-weight`, `border-radius`, and `box-shadow` must use the
corresponding user-controlled tokens. This is a review aid, **not** an untrusted CSS
sandbox. Do not relax its allowlist to accommodate a one-off visual effect.
Decorative rules must not override selection, editing or connection-target rings.
Check the cascade against the base components, including equal-specificity rules.

## Semantic reference

`paletteSchema` and `appearanceVariables()` in `packages/shared/src/appearance.ts`
are the source of truth. Manifest keys use camelCase; generated CSS variables use
kebab-case. Both modes must define every role; do not derive dark mode by inversion.

| Manifest roles                   | CSS variables                            | Intended use                                             |
| -------------------------------- | ---------------------------------------- | -------------------------------------------------------- |
| `bg`, `paper`                    | `--bg`, `--paper`                        | Workspace background and opaque writing/reading surfaces |
| `sidebar`, `surface`             | `--sidebar`, `--surface`                 | Navigation chrome and controls/panels                    |
| `hover`, `line`                  | `--hover`, `--line`                      | Hover feedback and structural separators                 |
| `text`, `muted`, `subtle`        | `--text`, `--muted`, `--subtle`          | Primary text, secondary labels and quiet metadata        |
| `accent`, `accentBg`, `onAccent` | `--accent`, `--accent-bg`, `--on-accent` | Links/actions, soft emphasis and solid-action labels     |
| `selection`, `focus`             | `--selection`, `--focus`                 | Selected content and visible keyboard focus              |
| `green`, `warning`, `danger`     | `--green`, `--warning`, `--danger`       | Success, caution and destructive/error states            |
| `code`, `codeText`, `syntax`     | `--code`, `--code-text`, `--syntax`      | Code surface, code text and syntax emphasis              |
| `callout`                        | `--callout`                              | Explanatory/research callout surface                     |

Typography uses `--font-ui`, `--font-prose`, `--font-heading`, `--font-code` and
their matching `--weight-*` tokens. Do not apply the prose font to menus or the UI
font to equations. The base application owns `--size-ui`, `--size-prose`,
`--size-code`, heading/math scales, line height, reading width and spacing.
Decorative pack rules may consume `--radius` and `--shadow`; they may not redefine
those tokens or fix sizes in pixels. A zero-radius or no-shadow
user choice must remain effective everywhere.

Base `appearance.css` derives compact UI type and shape roles and panel padding
from those preferences. Use those shared roles in component code; theme packs
must not redefine them. Keep panel frames on the outer, non-scrolling container
and avoid recoloring flat settings sections as nested cards. A pack's optional
card shadow never replaces Canvas selection/connection outlines or focus rings.
The Writing/Interface selector belongs to the shared scratchpad toolbar, so review
both surfaces without adding another toolbar or duplicating layout in pack CSS.

Block-range guides are editor-only decorations, never saved Markdown. Keep their
1px rails outside content and preserve pointer transparency; do not add drag
handles, padding shifts, or guide rules to Read/print output. Base geometry follows
the prose size rather than each heading's larger font. One margin track serves
each list level; an inspected item's emphasis overlays it, including task rows with
negative checkbox margins. Do not add a second permanent rail per list item or
nested quote. Neutral `--text` mixes supply quiet tracks and stronger hover/caret
guides; reserve theme accent colors for interactive controls.
Caret emphasis disappears when the editor loses focus. The base stylesheet owns
these geometry/state rules, reduced-motion handling and forced system colors.
Folding chevrons occupy the same gutter, outside the editable DOM.
They appear on hover/keyboard focus and stay visible for collapsed blocks. Retain
their 20px hit area, visible keyboard focus, `aria-expanded` state and compact
ellipsis summaries. Folding is local projection state, never another document or
persisted theme setting; hiding guide lines must not strand a collapsed block.
Metadata and link definitions share `PropertyTable` presentation, not a document
model or transaction engine. Their node views retain independent source-backed
drafts, collaborative anchors and undo behavior. `editor-paper.css` owns their
caption, horizontal rules, adaptive key column, document-table typography, cell
padding and square cell-level focus cue, including read-mode metadata. Values
inherit the ordinary table's font/size/padding; captions keep quiet UI typography.
Use `--paper`, `--line`,
`--text`, `--muted`, `--focus` and `--danger`; no fixed colors, filled key columns,
rounded cards or persistent instruction footers. Do not replace a focused input
with a display node. Required errors are visible inline; routine status is announced
without occupying a row. Hover/focus actions reserve their geometry and remain
keyboard reachable. Review guides both enabled and disabled, including deeply
nested tasks and quotations.

**Single-sheet contract:** document-editing controls carry `data-editor-field`
(`cell` for property fields, `inline` for the code-language field). General form
rules in `globals.css`, `appearance.css`, `workspace-design.css` and `workbench.css`
explicitly exclude these controls without increasing specificity for ordinary
forms. Do not add a stronger competing reset or `!important` override. Inputs
stay transparent, borderless, square and shadowless in idle, hover, focus, invalid
and read-only states. The cell owns focus/error outlines; errors also have text.
Hover may strengthen a straight table rule, but must not fill or reshape a field.

Embedded code/TeX source, its content/gutters, preview and toolbar are transparent
through to the nearest document host, including tinted canvas cards. Unhighlighted
source uses `--text`; syntax keeps `--syntax`, `--accent` and `--muted`. Validate
these against **paper**, not only the separate `--code` surface. `--code` and
`--code-text` still serve inline code, portable exports and other tool surfaces.
Code and equation blocks reveal a square 2px inset outline on hover, using a
text/rule blend; keyboard focus uses `--focus` (system `Highlight` in forced
colors). Idle blocks remain unboxed. Focus/hover must never change block padding,
typography or geometry. Selection,
search, collaborator and optional active-line highlights are intentional overlays;
do not erase them with a blanket background reset. App Read mode follows the same
sheet; public-site/export profiles remain independent.

Keep shared document-block presentation in `editor-paper.css`; `editor-vnext.css`
owns engine layout, source visibility and editor-specific overlays. Do not re-add
conflicting table/metadata/code surface rules there. Completion panels, field
dialogs and action controls use semantic radius, shadow and UI-size tokens;
zero-radius/no-shadow preferences and forced-color focus cues must still work.
`app/styles.ts` is the single ordered production stylesheet entrypoint, including
fonts and application forms. Both the root layout and in-memory lab import it;
do not replace the lab's import with a curated editor-only subset. A contract test
guards this boundary. Browser tests inspect the fields themselves in every state,
not merely their wrappers, and verify that ordinary application forms keep their
own filled/rounded style. The lab exercises
`docs/theme-fixtures/research.md` in all pack/style/light-dark combinations.

The optional document minimap consumes the same paper, text, muted, accent and
syntax tokens, with prose/code font roles for its canvas miniature and UI type for
labels/menus. It is a navigation column, not another editor. Base code owns width,
geometry, viewport/marker hit targets and compact-pane fallback; theme packs must
not reposition it, cover document content or change its pointer semantics.
Keep hover previews opaque and honor zero-radius/no-shadow choices. Review both
text and block rendering in light/dark modes, plus forced colors and reduced motion.
The miniature never loads images, renders remote content, or adds equation fonts
independently; equation/image shapes represent blocks without duplicating their
rendering work. Print and exports exclude the column, labels and previews.

The default validator checks ten named contrast pairs in each mode. This is
not a substitute for reviewing every combination: muted/subtle text on a selected
row, warning/danger on callouts, tooltips, disabled controls, rich content and
exported pages need visual and accessibility review too. Required information
must never depend on faint metadata or color alone.

## Precedence and responsibilities

| Layer            | Owns                                                                      |
| ---------------- | ------------------------------------------------------------------------- |
| Accessibility    | Forced colors, focus visibility, reduced motion/transparency; always wins |
| User preferences | Explicit palette overrides, fonts, sizes, density, shape, effects         |
| Theme pack       | Paired base colors and scoped decorative presentation                     |
| Base application | Layout, geometry, interaction, authorization, editor semantics            |

Choosing a pack does not clear custom overrides or silently replace typography.
“Preview pack colors without overrides” explicitly clears the draft's color
overrides; Apply/Cancel retain normal transactional settings behavior. High-contrast
base presets bypass pack palettes. Browser forced colors still take precedence.
Returning to Axiom default restores the base palette pipeline, not arbitrary
default values for unrelated settings.

Do not style card positions/dimensions, table cell geometry, caret/source mappings,
hit areas, visibility, pointer events, scrolling, z-index, focus removal, access
states, or content through a pack. Do not inject generated Markdown or change
document data. Never put shadows behind every nested content layer. UI fonts and
document fonts remain independent. CJK, Greek, mathematics, long identifiers, and
large code/table blocks are required fixtures, not optional polish.

## Release review

- Both modes; body/secondary/link/button text ≥4.5:1, essential focus ≥3:1.
- Keyboard focus, selected/pressed/disabled/pending/error/retry states; icons plus
  text, not color-only meaning. Menu dividers and clear danger actions.
- 150% UI scale, large prose/code sizes, long names, empty and unavailable cards.
- Write/Read/Source, math, code, table, footnotes, nested quotes, task alignment,
  dialogs, settings split panel, Explorer, Canvas, and export output.
- Reduced motion, forced colors, user shadows set to None, user radius zero.
- Chromium, Firefox and WebKit screenshots. Record manual IME/clipboard checks
  separately; synthetic composition events do not certify physical input methods.

Current packs: **Paper Research**, **Technical Slate**, **Botanical**, **Spectrum**
and **Graphite Ink**. The latter three require Appearance schema 12. Each pack
provides a paired light/dark palette and scoped link/rule/caption treatment, not
an interface recipe or font override. Default appearance stays
unchanged. Increment pack contract versions when the meaning of a manifest field
changes; reject unsupported versions rather than falling back and overwriting
saved choices. Add forward database/preference migrations for released schemas.

## Review and maintenance handoff

Submit the manifest, stylesheet, fixture and license/asset inventory together.
Record the application build, browser engines, tested modes and outstanding
manual checks in acceptance notes. Include screenshots of the Interface specimen
and the same research fixture in writing, reading, Canvas and export contexts.
Keep incomplete acceptance explicit; an automated pass is not an IME, physical
clipboard or assistive-technology certification.

Keep an existing pack ID stable once preferences refer to it. A new visual variant
gets a new ID; incompatible contract changes need an explicit migration and tests
for older saved preferences. Do not silently map an unknown pack to a different
theme and persist it. For a component redesign, update the fixture and base
component styles first, then review each pack against the changed selectors.
Layout and interaction fixes belong in shared components, never duplicated across
theme stylesheets.
