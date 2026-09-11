# Writing in Axiom

Choose **Write** for live preview, **Source** for literal Markdown, or **Read** for a clean document. Click an equation to edit LaTeX with its live preview. Code stays highlighted while you type, tables have directly editable cells, and quotes/callouts keep their visual structure. Use a code block's language field or a callout's title/type controls to edit its metadata. Double-click an image to reveal its Markdown.

Use the toolbar or `Ctrl/Cmd B` and `Ctrl/Cmd I` for formatting. `Ctrl/Cmd K` searches the group. `Ctrl/Cmd /` switches Source/Write; `Ctrl/Cmd Shift M` remains an alias. Type `/` in an empty paragraph to insert blocks, or open the command palette with `Ctrl/Cmd Shift .`. Lists, tasks and quotes continue on Enter; Enter again on an empty item exits one level. All 69 commands are available in the palette and shortcut settings. See the [editor and shortcut guide](EDITOR.md).

## Research syntax

```markdown
## A result

Inline math: $E=mc^2$.

$$
E=mc^2\label{energy}
$$

Refer to equation \eqref{energy}.

> [!THEOREM] Conservation
> State the assumptions and the result.

> [!PROOF]
> Justify each step.

Connect [[Another note]] or [[note-id|Readable label]].
Type [[ to choose a stable note link from autocomplete.

Use a reference [@author2026] or multiple [@first2025; @second2026].
Type [@ for citation-key autocomplete after adding sources to the library.

Supporting detail[^boundary].

[^boundary]: State the boundary conditions here.

- [ ] Check units
- [x] State assumptions

| Quantity | Meaning |
| -------- | ------- |
| $E$      | Energy  |
```

Fence code with a language such as `python`, `julia`, `rust`, or `latex`. Fence diagrams with `mermaid`; diagrams use strict security settings. Invalid math or diagrams preserve the source so you can correct it. Built-in math macros include `\R`, `\N`, and `\E`; simple document-level `\newcommand` definitions in display math are also supported.

The library accepts manually entered references, explicit DOI/arXiv lookup, or `.bib` import. Citation keys are stable; changing a paper's display title does not require changing its key. Attach a PDF through the toolbar, open its attachment card, and use **Link this page** to insert a page-specific reference. The split-pane reader supports private highlights, figure areas, page notes, quotation links and opt-in offline copies. See [appearance and paper reading](READING.md) for personal queues, bookmarks, theme customization, and data boundaries.

Select text and use **Comment on selection** for an anchored thread. After a version restore or deletion of the selected text, an anchor may no longer resolve; the original quotation remains readable. Save named milestones before major changes. A private draft is visible only to its author; **Share → Publish to group** makes it collaborative.

Watch the save indicator. If access changes or synchronization fails, export the current local Markdown before signing out or clearing browser data. Restoring an older version asks other collaborators to reopen it; it does not silently discard their old local copy.

## Portable copies

Note actions provides local Markdown export, HTML export, and Print / save as PDF. HTML includes equation fonts, table styling, citations, and up to 20 MB of authorized attached images; it needs no external math CDN. Diagram source is preserved in HTML; print the rendered Read view for diagram figures. Linked PDFs, other notes, and externally hosted images may still need connectivity and group access.

Use Settings → Export group archive for shared notes, projects, hierarchy, attached files, and `references.bib`. Imports always create new copies and offer a preview before writing. A group archive excludes private drafts and account/history data; export private Markdown individually and use the administrator backup utility for disaster recovery.
