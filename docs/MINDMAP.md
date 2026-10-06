# Native Markdown mind maps

Mind maps are another view of ordinary Markdown, not a second content store.
Choose **Mind map** in a note's toolbar; **Document** returns to writing. Explorer's
new-file menus also create a **Mind map** file that opens in the map by default.
Both use `/workbench/notes/:id`: `?view=mindmap` selects the map and
`?view=document` overrides a map file's default presentation.

This increment is implemented in source. Browser, authenticated collaboration
and migration acceptance remain pending; see [Verification](VERIFICATION.md).
No working database was migrated or service deployed by this implementation.

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
boundary. Code, tables, equations and media use compact labels; **Block details**
shows the original rich block. Long labels are summarized, never source-truncated.
Frontmatter, reference/footnote definitions, dividers and TOC blocks are supporting
material, not extra branches. They remain in Source, Document and Markdown export.
Use Canvas for freely positioned cards/cross-connections, or the knowledge graph
for persisted research relationships; this map expresses document hierarchy.

| Action                | Interaction                                                    |
| --------------------- | -------------------------------------------------------------- |
| Select / edit a label | Click / double-click or F2                                     |
| Apply / cancel label  | Enter / Escape in the field                                    |
| Add sibling / child   | Enter / Mod-Enter on a node                                    |
| Navigate              | Up/Down siblings, Left parent, Right first child, Home root    |
| Fold / expand         | Space or the branch toggle; Tab remains normal navigation      |
| Reorder / outdent     | Alt-Up/Down / Alt-Left; guarded context actions                |
| Drag a branch         | Top/bottom edge = before/after; center = child                 |
| Remove branch         | Backspace/Delete, with confirmation and author-local Undo      |
| Pan / zoom / frame    | Empty-space drag or scroll / Mod-scroll / Fit                  |
| Search                | Type to highlight; Enter cycles, reveals ancestors and focuses |
| Canonical source pane | Source or Mod-/; one resizable auxiliary pane                  |

`Mod` means Command on macOS and Control elsewhere. Label/source fields keep their
normal typing keys. Newly added labels enter editing immediately. Synthetic roots
and multiline/container blocks use the existing file controls or Source. Task
checkboxes update their original Markdown markers. Icon-labeled context groups
provide structure and permission-checked discussion, bookmark and annotation
actions using existing stores. There is no separate map comment system.

## Appearance, source and collaboration

Display provides rightward, leftward and balanced layouts, comfortable/compact
spacing, theme accent/spectrum branches, node width, initial expanded depth and
Expand/Fold all. Colors, component treatment, reading fonts/size, radius, contrast
and motion inherit normal preferences. Editor fields remain transparent. Only one
map source/details pane is open; opening the workbench inspector closes it.

Camera, folds, selection, pane and display are account/file/generation-local.
Dedicated files may save typed display defaults; readers can override them.
Executable frontmatter, injected CSS and remote layout settings are not supported.

Map, Document and Source share the **same NativeBinding, Y.Text, collaboration
session, durable journal and author undo**. Presence refers to original source
ranges. Commands recheck current permission and projection; draft labels and
dragged branches use relative collaborative anchors, never similar-label matching.
If a label is changed/replaced or access ends, its unapplied draft stays copyable
rather than overwriting the peer. Browser unload protection warns about changed
drafts where supported. Apply/copy them before changing files/views: unapplied
label drafts are not durable document saves.

## Exports and portability

Whole-map or branch export supports Markdown, SVG, PNG, PDF and interactive offline
HTML. Visual exports expand branches regardless of current folds. Whole Markdown
keeps exact source; branch Markdown includes supporting metadata/link/footnote
definitions so references stay available. Plain SVG/HTML labels are escaped
selectable text; rich labels are inert embedded PNGs with local math/fonts, and
connectors stay vector. Media is summarized, not fetched. Private comments,
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

`packages/mindmap` owns native projection, source commands, layout, worker caching
and export serialization. Production and showcase share
`apps/web/components/mindmap/MindmapSurface.tsx`, the existing Markdown/math renderer
and text surface. Display/export dialogs are separate from document commands and
use shared native UI controls. No external hierarchy/layout runtime was added.

Projection is bounded at **5,000 nodes, 64 hierarchy levels and one million source
characters**. Complexity/limit errors offer complete Source/Document rather than
silently publishing a partial tree. One-current-projection worker caching,
coalesced requests, stale-result rejection, measured-size/label caches and
off-screen node culling keep interaction bounded; selected focus remains mounted.
Positional node IDs are transient render IDs, not durable identity or authority.

Moves preserve CRLF/BOM, marker styles and fenced descendants. Conversion, H7,
ambiguous lazy/tab indentation and container crossings require Source. Simulated
moves are reparsed to reject unexpected changes to other blocks' interpretation.

Migration **49** only expands `tool_projects_kind_check`; it does not rewrite
notes, CRDT state, history or formats. Use the normal backed-up migration workflow
after isolated acceptance. Never run mutation tests against working research data.

```bash
node --import tsx scripts/verify/mindmap-migration.ts
npx vitest run tests/mindmap.test.ts tests/mindmap-contracts.test.ts
npm run showcase:build
npx playwright test --config showcase.config.ts tests/showcase/mindmap.spec.ts
```

The disposable SQL gate covers fresh schema, 48→49, controller rerun, exact
source/Yjs/profile preservation and invalid kinds. Also run typecheck, lint,
UI/theme/docs validation and production/offline builds. Inspect actual browser
screenshots in light/dark, large text, keyboard, forced colors and reduced motion,
including scroll ownership and footers. Multi-user collaboration, revocation and
restore need a disposable authenticated environment: pure anchors do not certify
those runtime paths. See the [UI controls contract](UI_CONTROLS.md).
