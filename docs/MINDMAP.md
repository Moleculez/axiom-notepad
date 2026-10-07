# Native Markdown mind maps

Mind maps are another view of ordinary Markdown, not a second content store.
Choose **Mind map** in a note's toolbar; **Document** returns to writing. Explorer's
new-file menus also create a **Mind map** file that opens in the map by default.
Both use `/workbench/notes/:id`: `?view=mindmap` selects the map and
`?view=document` overrides a map file's default presentation.

Production and the browser-local showcase share this surface. See
[Verification](VERIFICATION.md) for current browser checks and the separate
authenticated collaboration/migration gates. No working database was migrated or
service deployed by this usability update.

## Structure and interactions

```markdown
# Research programme

## Question

- A testable hypothesis
  - Supporting evidence
  - Competing explanation

## Methods

- [x] Review the literature
- [ ] Reproduce the baseline
  - Record seeds and data versions
```

A single first, document-wide H1 becomes the root. Otherwise the file title is
the root, with multiple top-level sections beneath it. Headings and nested bullet,
numbered and task items form branches. Short prose retains inline formatting,
links and mathematics. Quotations and research callouts retain their container
boundary. **Research previews** show rendered equations, highlighted four-line code
excerpts with language icons, complete Mermaid diagrams, bounded images,
three-column/three-body-row table excerpts and bounded quote/callout content.
Images use the same permitted addresses or host asset registry as the document;
the browser-local showcase resolves only imported/bundled local assets. Missing
images show their description; failed loads offer **Retry**. Attachment tiles stay
inert. **Compact previews**
use summaries instead; **Branch details** shows the original rich block. Long labels
are summarized, never source-truncated. Optional **Supporting material** adds
source-backed, read-only metadata and reference/footnote definitions beneath one
separate group. Dividers and TOC blocks remain in Source and Document. All supporting
source remains in exact Markdown exports whether visible on the map or not.
Mermaid fences are never truncated into code excerpts. The shared strict renderer
disables external diagram resources and bounds source at 30,000 characters and
2,000 edges. Temporary syntax errors retain a labeled last-valid diagram; Source
always retains the original code. Diagram/image previews fit the node width and
11rem height; Details offers the full block. Theme changes refresh diagram colors,
but source edits and image/diagram completion do not reset the camera's zoom.
Use Canvas for freely positioned cards/cross-connections, or the knowledge graph
for persisted research relationships; this map expresses document hierarchy.

| Action                | Interaction                                                                      |
| --------------------- | -------------------------------------------------------------------------------- |
| Select / edit a label | Click / double-click or F2                                                       |
| Apply / cancel label  | Enter / Escape, or the small apply/cancel actions                                |
| Add sibling / child   | Enter / Mod-Enter on a node                                                      |
| Navigate              | Up/Down visible document order; Left folds/parent, Right expands/child; Home/End |
| Fold / expand         | Space or contextual toggle; collapsed badges count all descendants               |
| Toggle task           | Native checkbox or T on the selected task; one author-local undo step            |
| Reorder / outdent     | Alt-Up/Down / Alt-Left; guarded context actions                                  |
| Drag a branch         | Top/bottom edge = before/after; center = child                                   |
| Remove branch         | Backspace/Delete, with confirmation and author-local Undo                        |
| Pan / zoom / frame    | Empty-space drag or scroll / Mod-scroll / Fit                                    |
| Search                | Enter/Shift-Enter or previous/next; clearing restores unchanged folds            |
| Canonical source pane | Source or Mod-/; one resizable auxiliary pane                                    |
| Focus / return        | Branch actions → Focus; breadcrumb ancestors / Show entire map                   |
| Multiple branches     | Mod-click toggles; Shift-click/Shift-arrow selects a visible range               |
| Select / copy         | Mod-A selects visible branches; Mod-C copies normalized Markdown                 |
| Overview              | Opt-in minimap; click/drag/arrow keys pan without changing zoom                  |

`Mod` means Command on macOS and Control elsewhere. Label/source fields keep their
normal typing keys. Newly added labels enter editing immediately. Synthetic roots
and multiline/container blocks use the existing file controls or Source. Task
checkboxes update their original Markdown markers. Icon-labeled context groups
provide structure and permission-checked discussion, bookmark and annotation
actions using existing stores. There is no separate map comment system.
Selected ancestors subsume selected descendants for copy/delete. Complete/Reopen
tasks applies to selected subtrees as one author-local undo step. Copy code omits
fences. Guarded moves show valid destinations or rejection reasons before dropping;
hovering a valid folded destination expands it after a short delay. Escape, lost
capture or window blur cancels a drag. The destination follows stationary edge
panning and is checked again on release; source changes cancel the move rather
than applying a stale destination. Keyboard reorder provides a non-drag path.

## Research navigation

The toolbar's research lens selects **All content**, **Equations**,
**Figures & diagrams**, **Code**, **Tables**, **Linked evidence** or
**Unfinished tasks**. Search includes indexed block content, not only shortened
labels, and combines with the lens within the focused branch. Matching nodes are
highlighted; **Focus results** keeps matching nodes and their ancestor paths.
The complete source remains available. Clearing a view filter does not reset zoom
or remove the saved fold state. Selected paths have a quiet visual emphasis, and
branch task counts include their complete subtree rather than just visible items.

**Branch details** has three keyboard-operable tabs in the existing auxiliary pane:

- **Block** shows the full rich branch with Source, Document and eligible visual
  inspection actions.
- **Evidence** groups linked notes, links, citations, footnotes and equation
  references, with authorized navigation and precise source-range actions.
- **Tasks** shows open and completed branch tasks with screen-sized native
  checkboxes, useful when the map is zoomed out. Task edits use the same guarded
  Markdown transaction as the node checkbox.

Block previews and Details inherit definitions, footnotes and equation numbering
from the same source revision as the map. Reference-style images and links do not
lose their document context when rendered as separate nodes. Internal headings,
equations and figures navigate within the map; footnotes and bibliography links
open Evidence. Images and Mermaid diagrams can open the shared visual viewer
through explicit inspection, not hover.

Source, research navigation, Fit/zoom and Branch details remain readily accessible.
**More map options** groups hierarchy/depth actions, overview, display, export,
selected-branch actions and shortcuts instead of a permanent row of secondary
icons. Context menus retain their keyboard operation and permission checks.

## Appearance, source and collaboration

Display provides rightward, leftward and balanced layouts, comfortable/compact
spacing, theme accent/spectrum branches, node width, initial expanded depth and
Expand/Fold all and depth presets. Research/compact previews, supporting material
and the optional minimap are local view choices; the latter two default off.
Colors, component treatment, reading fonts/size, radius, contrast
and motion inherit normal preferences. Every node has one opaque paper frame,
a thin neutral border and preference-derived compact corners; root/section
weights and quiet branch rails show hierarchy. There are no per-node shadows or
nested code/image/diagram cards. Selection, hover, search and drop states do not
change the measured box or connector geometry. Editor fields remain transparent. Only one
map source/details pane is open; opening the workbench inspector closes it.

The source pane defaults to 360px, with a 240px minimum and an available-space
maximum up to 900px. Drag its edge, use Arrow keys (Shift for larger steps),
Home/End for bounds and Enter/double-click to reset. Escape cancels pointer resizing.
When the pane cannot share useful desktop space, Source/Map becomes a
state-preserving switch; it does not squeeze both surfaces into unusable columns.

Camera, folds, focus, selection, pane and display are account/file/generation-local.
Dedicated files may save typed display defaults; readers can override them.
Executable frontmatter, injected CSS and remote layout settings are not supported.
Typing, undo, rendering equations, resizing panes and closing Display **do not reset
zoom**. Layout changes keep a surviving selected source anchor at its screen
position. Only explicit Fit, Fit selected branch or zoom controls change scale.
Keyboard/search navigation minimally pans a target into view. Map counts use the
host's fixed `ws-note-footer` beside document statistics, never a second footer.

Map, Document and Source share the **same NativeBinding, Y.Text, collaboration
session, durable journal and author undo**. Presence refers to original source
ranges. Commands recheck current permission and projection; draft labels and
dragged branches use relative collaborative anchors, never similar-label matching.
If a label is changed/replaced or access ends, its unapplied draft stays copyable
rather than overwriting the peer. Changed-label navigation offers **Apply and
leave**, **Discard and leave** or **Stay**, plus Copy. Applying rechecks the source
range and edit access; a conflict keeps the draft and blocks navigation. File,
mode, sidebar and history navigation use the shared exit guard, rechecking another
dirty owner before continuing. Browser unload protection warns where supported.
Unapplied labels remain in memory, not durable document saves: apply or copy them
before closing the browser.

## Exports and portability

Whole-map or branch export supports Markdown, SVG, PNG, PDF and interactive offline
HTML. Visual exports expand branches regardless of current folds. Whole Markdown
keeps exact source; branch Markdown includes supporting metadata/link/footnote
definitions so references stay available. Plain SVG/HTML labels are escaped
selectable text; rich labels are inert embedded PNGs with local math/fonts and
rendered Mermaid diagrams. Paper frames, resolved radius/branch colors and
connectors stay vector. Frames follow the current surface and explicit square
corner preference rather than a separate export theme. Images and attachments
are summarized, not fetched, by visual exports. Private comments,
presence, reading records and workbench URLs do not leave the application.

Export freezes a source snapshot; an intervening edit requires reopening. Long
captures are cancellable and recheck access before download. Rich capture supports
120 nodes and 64 megapixels of label pixels. Raster output is limited to 32
megapixels/safe canvas dimensions; tiled PDF retains its bounded page budget.
Use plain vector, exact Markdown or a selected branch for larger maps. Offline
HTML embeds only first-party pan/zoom/fit/fold code, never user scripts.

Portable research collections and browser-local showcase ZIPs retain the profile.
Source format stays **markdown**, with `toolKind: mindmap` and typed settings.
Existing reviewed AI/MCP file-creation actions can request this kind; it grants no
new authority and does not bypass review.

## Contributor and acceptance contracts

`packages/mindmap` owns native projection, source commands, preview descriptors,
navigation/research indexes, layout, worker caching and export serialization. Production and showcase share
`apps/web/components/mindmap/MindmapSurface.tsx`, the existing Markdown/math renderer
and text surface. Display/export dialogs, preview/overview/footer components and
identity/measurement hooks are separate from source commands and use shared native
UI controls. Research filters derive a separate read-only topology for layout and
keyboard traversal; commands, collaborative identities and task aggregation retain
the complete canonical projection. Filtering does not acquire edit authority or
change Markdown. No external hierarchy/layout runtime was added. Live and exported rich
previews use the same bounded descriptors; exports freeze the preview treatment.
Embedded Details readers opt into map-level internal-anchor navigation; ordinary
document readers retain their native equation/footnote anchors. Build visual
placements only when the displayed source matches the live binding, and recheck
that revision before opening inspection. Footnote galleries include only that
footnote's AST and its matching source, not unrelated definition visuals.

Projection is bounded at **5,000 nodes, 64 hierarchy levels and one million source
characters**. Complexity/limit errors offer complete Source/Document rather than
silently publishing a partial tree. One-current-projection worker caching,
coalesced requests, stale-result rejection, measured-size/label caches and
off-screen node culling keep interaction bounded; selected focus remains mounted.
Positional node IDs are transient projection IDs, not durable identity or authority.
React keys and measured dimensions follow collaborative source-range identities,
not shifted offsets. Measurements use intrinsic unscaled dimensions, coalesce
font/math/ResizeObserver updates and enqueue layout only on real size changes.
Equation/diagram/image DOM is not rewritten during pan/zoom. Changed equations
and diagrams retain the last painted preview, labeled updating, until new rendering
finishes. Diagram rendering shares the serialized document renderer and discards
obsolete jobs; image events and retries have one cancellable owner per label.
Exports await current math/diagram rendering and reject incomplete captures.
Keyboard traversal uses current fold, focus and research-filter intent rather
than waiting for the asynchronous layout worker. Worker layout and UI navigation
share the same pure view-topology derivation; content commands never use that
filtered topology.

Moves preserve CRLF/BOM, marker styles and fenced descendants. Conversion, H7,
ambiguous lazy/tab indentation and container crossings require Source. Simulated
moves are reparsed to reject unexpected changes to other blocks' interpretation.

Migration **49** only expands `tool_projects_kind_check`; it does not rewrite
notes, CRDT state, history or formats. Use the normal backed-up migration workflow
after isolated acceptance. Never run mutation tests against working research data.

```bash
node --import tsx scripts/verify/mindmap-migration.ts
npx vitest run tests/mindmap*.test.ts tests/markdown-fragments.test.ts
npm run showcase:build
npx playwright test --config showcase.config.ts tests/showcase/mindmap*.spec.ts
```

The disposable SQL gate covers fresh schema, 48→49, controller rerun, exact
source/Yjs/profile preservation and invalid kinds. Also run typecheck, lint,
UI/theme/docs validation and production/offline builds. Inspect actual browser
screenshots in light/dark, large text, keyboard, forced colors and reduced motion,
including scroll ownership and footers. Multi-user collaboration, revocation and
restore need a disposable authenticated environment: pure anchors do not certify
those runtime paths. See the [UI controls contract](UI_CONTROLS.md).
