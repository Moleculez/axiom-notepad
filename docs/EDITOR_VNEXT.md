# Axiom editor: current architecture and release status

## Which editor ships?

The development and production defaults both select **AxiomEditorView**, the current
customized Axiom editor. The historical configuration value is `milkdown`:
`NEXT_PUBLIC_AXIOM_EDITOR_ENGINE=milkdown`. This selects Axiom's implementation, not
Milkdown's stock editor or theme.

It is important not to overstate ownership: Milkdown/ProseMirror provides the rich
editing surface and CodeMirror 6 provides source and embedded text surfaces. Those
libraries are runtime dependencies. Axiom owns the Markdown parser, canonical-source
transactions, projection/mapping, collaboration integration, specialized block views,
commands and product styling. It is **not** an entirely first-party replacement of
Milkdown/ProseMirror or CodeMirror, nor a copy of Typora's proprietary implementation.

`NEXT_PUBLIC_AXIOM_EDITOR_ENGINE=native` selects the older first-party DOM engine for
explicit rollback/testing. This is a build-time deployment switch, not a user-facing
choice or a second document format. The legacy engine must not be removed merely
as storage cleanup: current code still shares its utilities and compatibility paths.

## Source of truth

Images and Mermaid previews share the [visual viewer](VISUAL_VIEWER.md). Double
click opens inspection without source mutations; ordinary single-click editing
remains intact. Region markup has separate persistence and undo from the document.

`Y.Text('markdown')` is canonical. Axiom's parser exposes UTF-16 source spans; the
rich document is a projection, not a separately serialized authority. ProseMirror
transactions are translated into bounded source edits. Milkdown's stock Markdown
serialization, history, collaboration and input-rule plugins are not enabled.
Mode changes do not rewrite the note. One author-local Yjs undo history spans visual,
source and embedded editing, and the legacy engine uses the same document contract.

| Responsibility                                     | Implementation                                                |
| -------------------------------------------------- | ------------------------------------------------------------- |
| Block/inline Markdown parsing and research syntax  | `packages/markdown/src`                                       |
| Source transactions, schema, projection and bridge | `packages/editor/src`                                         |
| Milkdown/ProseMirror lifecycle adapter             | `packages/editor/src/rich-surface.ts`                         |
| CodeMirror source adapter                          | `packages/editor/src/text-surface.ts`                         |
| Axiom block interactions and UI                    | `apps/web/lib/editor-vnext`                                   |
| Application/session integration                    | `apps/web/components/Editor.tsx`                              |
| Explicit legacy selector                           | `apps/web/lib/editor-view.ts`                                 |
| Durable synchronization                            | `apps/sync/src/server.ts`, `packages/shared/src/documents.ts` |

## Retained researcher workflows

- Optional [document minimap](MINIMAP.md): mode-aware miniature, scroll-only
  navigation, viewport dragging and unified reading/search/presence markers.

- Source/visual/read modes; source-preserving headings, lists/tasks, quotes, images,
  dividers and footnotes; direct table editing; specialized code and TeX blocks.
- Slash insertions and configurable shortcuts; language suggestions; math-symbol
  suggestions; source mapping inside nested containers. Code-body snippet completion
  remains disabled as requested.
- Rendered images with an above-image source line on activation, rich footnote
  definitions, hover footnote content, and LaTeX-style math delimiters.
- Collaborative editing/presence, author-local undo, local persistence, reconnect
  recovery, explicit server-save acknowledgement and permission changes.
- Outline/TOC, citations, equation navigation, annotations, anchored discussion,
  snapshots, exports and shared Canvas rich-text cards.
- Shared theme tokens, local fonts, quiet hover/focus controls, keyboard menus and
  pinned editor status. Theme authoring follows [the same UI criteria](THEME_AUTHORING.md).

These are implemented workflows, not a claim of complete Typora feature parity.

## September 13 interaction refinements

- [Reading marks](READING_MARKS.md) adds editable/deletable private bookmarks,
  block/selection-relative anchors, right-margin markers and an overview rail.
  Private-first annotation cards use an isolated instance of the same rich/source
  editor, durable local drafts and a guarded private outbox. Explicit sharing
  joins the existing Discussion threads; reader/commenter/author permissions and
  visibility/version conflicts are enforced by the central API. Migration 19 is
  additive; appearance schema 7 adds the two independent marker toggles.

- Display equations retain their typeset DOM when edits move their source offsets.
  An equation being edited keeps its last preview while the math worker prepares
  the next result; macro/label changes still invalidate the appropriate content.
- Bullets, ordered markers and task checkboxes stay rendered during authoring.
  Completing a marker with whitespace opens the editable item body immediately.
  A bare `-`, `*`, `+` or numbered marker remains plain prose without a ghost bullet.
  Command/Ctrl+Enter makes a hard break inside that item; Enter creates the next
  item. Enter on an empty item outdents one actual nesting level, then exits.
  Tab requires a preceding sibling and respects ordered-marker widths.
- Empty final table rows exit to a following paragraph on Enter. Quotes, callouts
  and footnotes retain their empty-line exit behavior without lazy child capture.
  All block exits share parent-aware blank-line handling, preserving nested scope
  and LF/CRLF. Imported lazy continuation syntax is not rewritten by the parser.
- Backspace removes an already-empty rich block in one local undo step, preserving
  populated parents and siblings. Removing the last code/math character leaves an
  empty rich surface; the next Backspace removes its fences, not a bare opener.
  Tables are removable this way only when every cell is empty. Code/math Enter is
  literal; Command/Ctrl+Enter exits inside the appropriate parent container.
- Appearance → General → Show block ranges toggles quiet vertical guides, enabled
  by default. Nested groups step inward and the active range gains emphasis.
  Guides are view-only: no source changes, extra selection targets, layout shifts
  or exported marks. Preference schema 6 migrates older choices and protects them
  from stale-client writes.
- A Monaco-inspired folding gutter uses hover chevrons and compact one-line
  summaries for multiline code/math, list groups, quotes/callouts, tables,
  metadata and footnotes. Fold ranges are author-local and rebase through actual
  edit deltas; replacing their opening identity invalidates the fold. Source,
  history, permissions, exports and collaborators' views remain authoritative and
  unchanged. Explicit navigation reveals hidden contents; Read mode expands all
  contents, and print lifecycle events temporarily expose them. Headings are not
  section-folding controls in this pass. `packages/editor/src/folding.ts` owns
  range state, while `folding-gutter.ts` owns the out-of-flow control layer.
- `[TOC]` (or `/table of contents`) is a static heading navigator in Write mode,
  not a source editor. YAML frontmatter (or `/metadata`) uses a property table.
  Scalar keys/values use guarded field commits; structured YAML remains readable
  and is edited in Source mode. Comments and unrelated source are not normalized.
  The property table now uses a flat token-based layout with aligned key/value
  baselines, quiet separators and consistent light/dark/large-type presentation.

The `stem-v1` authoring dialect treats a whitespace-completed empty list marker
inside a container as an item, avoiding transient setext headings. CommonMark/GFM
conformance modes and the shared Y.Text format are unchanged. See
[typing integrity](TYPING_INTEGRITY.md) for the full interaction contract.

The block-boundary follow-up passes **1,599 unit tests**, **382 Chromium editor-lab
checks** (one opt-in benchmark skipped), and **158 focused Firefox/WebKit checks**
(two Chromium-only CDP composition cases skipped). These cover marker activation,
nested exits, empty-block removal, peer edits, author-local undo, permission guards,
LF/CRLF, metadata recovery and guide toggles without source/caret/geometry changes.
TypeScript, ESLint, theme validation and the isolated production build pass.

The new full-app checks live in `tests/e2e/editor-appearance-guides.spec.ts`;
editor screenshots are in `data/editor-lab-results` and
`data/editor-lab-boundaries-cross-browser`. **Ten full-app Chromium checks** pass
against the isolated production server: guide persistence/reset/cancel and stale
writers, metadata in light/dark/large desktop appearance, retained settings drafts,
offline preference conflicts and existing interface geometry. Fresh screenshots
are in `test-results/block-editing-acceptance`; the narrow/mobile test was excluded
from this desktop-only pass. Earlier production checks exercised the real math
worker in all three browsers without preview resets during typing; see the
[file-workbench verification notes](FILE_WORKBENCH.md) for that earlier pass.

## Acceptance boundaries

The subsequent folding-gutter pass passes **1,610 unit tests**, **400 Chromium
editor-lab checks** (one opt-in benchmark skipped), **76 focused Firefox/WebKit
checks**, and **three full-app Chromium checks**. A final 54-case three-engine
folding/style rerun passes after keyboard-order and caret-boundary fixes. Fresh
evidence is under `data/editor-folding-chromium-final`,
`data/editor-folding-cross-browser`, `data/editor-folding-caret` and
`test-results/editor-folding-current`. These include
light/dark/large text, nested folds, remote rebasing, replacement identities,
source/undo invariance, permissions, keyboard focus, valid caret placement around
collapsed atoms, print lifecycle restoration
and a real two-client collaboration session. TypeScript, lint, themes and the
isolated production build pass. Physical printing/IME acceptance is not implied.

See [current measured checks](VERIFICATION.md) and the
[detailed acceptance matrix](EDITOR_VNEXT_ACCEPTANCE.md). Physical OS IME, real
clipboard applications, physical Safari, assistive technologies and dense mixed
research workloads remain target-environment acceptance work. An intermittent
WebKit navigation diagnostic has historical failure evidence; a passing repeat
does not establish its root cause or prove it fixed.

Changing the dependency foundations is a separate engine migration with its own
input/caret, composition, collaboration, undo and recovery acceptance gates. Do not
present release cleanup or renaming as a dependency-free implementation.

The complete [earlier implementation log](archive/EDITOR_VNEXT-2026-09-11.md) remains
available for debugging. Its old production-default statements are superseded here.
