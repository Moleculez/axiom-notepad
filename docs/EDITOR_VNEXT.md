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

`Y.Text('markdown')` is canonical. Axiom's parser exposes UTF-16 source spans; the
rich document is a projection, not a separately serialized authority. ProseMirror
transactions are translated into bounded source edits. Milkdown's stock Markdown
serialization, history, collaboration and input-rule plugins are not enabled.
Mode changes do not rewrite the note. One author-local Yjs undo history spans visual,
source and embedded editing, and the legacy engine uses the same document contract.

| Responsibility | Implementation |
| --- | --- |
| Block/inline Markdown parsing and research syntax | `packages/markdown/src` |
| Source transactions, schema, projection and bridge | `packages/editor/src` |
| Milkdown/ProseMirror lifecycle adapter | `packages/editor/src/rich-surface.ts` |
| CodeMirror source adapter | `packages/editor/src/text-surface.ts` |
| Axiom block interactions and UI | `apps/web/lib/editor-vnext` |
| Application/session integration | `apps/web/components/Editor.tsx` |
| Explicit legacy selector | `apps/web/lib/editor-view.ts` |
| Durable synchronization | `apps/sync/src/server.ts`, `packages/shared/src/documents.ts` |

## Retained researcher workflows

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

## Acceptance boundaries

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
