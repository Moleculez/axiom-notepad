# Trusted theme packs · contract v1

Theme packs are reviewed source code compiled into Axiom, not uploaded plugins.
The JSON palette importer remains color-only (`axiom-theme`, v1). It never accepts
CSS, HTML, JavaScript, font URLs, or executable expressions. A saved pack ID only
selects an entry in the static registry; it never becomes a filesystem/import URL.

## Authoring a pack

1. Add a typed manifest to `packages/shared/src/theme-packs.ts` and register its ID
   in `themePackIds`. Use `format: "axiom-theme-pack"`, `version: 1`, and
   `minimumAppearanceSchema: 5`. Include name, description, author, license,
   stylesheet path, asset inventory, and at least one fixture path.
2. Supply complete light **and** dark palettes using the existing 21 semantic
   roles. Literal six-digit hex values belong here, not in component styles.
3. Add the stylesheet to `apps/web/themes/` and explicitly import it in the root
   layout. Every selector must begin with `[data-theme-pack="your-id"]`.
4. Use the existing UI/prose/heading/code font roles. Reuse licensed self-hosted
   fonts; new font assets require a reviewed base application change, provenance,
   license files, fallback stacks, and offline/export testing. Packs cannot load
   remote assets. Keep assets in the manifest even when used by base components.
5. Run `npm run validate:themes`, typecheck, unit tests, and browser acceptance.
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
Monaco-inspired folding chevrons occupy the same gutter, outside the editable DOM.
They appear on hover/keyboard focus and stay visible for collapsed blocks. Retain
their 20px hit area, visible keyboard focus, `aria-expanded` state and compact
ellipsis summaries. Folding is local projection state, never another document or
persisted theme setting; hiding guide lines must not strand a collapsed block.
Metadata uses the same paper and line tokens
as the document, aligned property rows and an accessible inset field-focus cue;
avoid filled key columns, heavy outlines or a second table font system. Review
guides both enabled and disabled, including deeply nested tasks and quotations.

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

The default validator checks eight named contrast pairs in each mode. This is
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

Current packs: **Paper Research** and **Technical Slate**. Default appearance stays
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
