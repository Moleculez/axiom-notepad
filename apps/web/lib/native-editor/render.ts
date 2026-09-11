import {
  renderDocument,
  documentIndex,
  sectionNumberAttributes,
  highlightCode,
  safeUrl,
  tableModel,
  type MarkdownNode,
  type ParsedDocument,
  type RenderContext,
} from "@axiom/markdown";
import type { EditorPreferences } from "@axiom/shared/editor";
import {
  displayOffsets,
  sourceOffsets,
  type MappedBlock,
  type TextMapping,
} from "./selection";
import { lineAt, type SourceSelection } from "./transactions";
import { literalBody } from "./literal";
import { intersects } from "./projection";
import { paintFootnoteReference } from "../footnote-tooltips";

export type RenderOptions = {
  source: string;
  parsed: ParsedDocument;
  context: RenderContext;
  selection: SourceSelection;
  focused: boolean;
  sourceMode: boolean;
  preferences: EditorPreferences;
  readOnly: boolean;
  codeOverrides: Map<number, { wrap?: boolean; numbers?: boolean }>;
  tableWidths?: Map<number, number[]>;
  activeCell?: { table: number; row: number; column: number };
};
const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
) => {
  const el = document.createElement(tag);
  el.className = className;
  return el;
};
function bounds(el: HTMLElement, from: number, to: number) {
  el.dataset.nfrom = String(from);
  el.dataset.nto = String(to);
  return el;
}
export function renderBlock(
  node: MarkdownNode,
  options: RenderOptions,
): MappedBlock {
  const { source, parsed, context, selection, focused, preferences, readOnly } =
    options;
  const maps: TextMapping[] = [];
  const contains = (n: MarkdownNode) =>
    focused &&
    !readOnly &&
    (n.type === "mathBlock"
      ? intersects(selection, n.from, n.to)
      : [selection.anchor, selection.head].some(
          (at) => at >= n.from && at <= n.to,
        ));
  const text = (
    parent: HTMLElement,
    value: string,
    from: number,
    to = from + value.length,
    offsets?: number[],
  ) => {
    const leaf = element("span", "native-text");
    bounds(leaf, from, to);
    const content = document.createTextNode(value);
    leaf.append(content);
    parent.append(leaf);
    maps.push({
      text: content,
      from,
      to,
      offsets: offsets ?? sourceOffsets(value, from),
    });
    if (!value) leaf.append(document.createElement("br"));
  };
  const fragment = (n: MarkdownNode) =>
    renderDocument(
      {
        ...parsed,
        ast: { type: "document", from: n.from, to: n.to, children: [n] },
      },
      { ...context, document: parsed, fragment: true },
    );
  const ui = (label: string, command: string) => {
    const button = element("button");
    button.type = "button";
    button.textContent = label;
    button.contentEditable = "false";
    button.dataset.nativeUi = "true";
    button.dataset.command = command;
    button.setAttribute("aria-label", label);
    return button;
  };
  const syntax = (parent: HTMLElement, from: number, to: number) => {
    if (to <= from) return;
    const span = element("span", "native-syntax");
    text(span, source.slice(from, to), from, to);
    parent.append(span);
  };
  const children = (parent: HTMLElement, n: MarkdownNode) => {
    if (n.children?.length) {
      for (let index = 0; index < n.children.length; index++) {
        const child = n.children[index];
        if (child.type !== "text") {
          parent.append(render(child));
          continue;
        }
        let value = child.text ?? "";
        let to = child.to;
        while (
          n.children[index + 1]?.type === "text" &&
          n.children[index + 1].from === to &&
          value === source.slice(child.from, to) &&
          n.children[index + 1].text ===
            source.slice(n.children[index + 1].from, n.children[index + 1].to)
        ) {
          const next = n.children[++index];
          value += next.text ?? "";
          to = next.to;
        }
        const raw = source.slice(child.from, to);
        // Decoded entities and escapes reveal their own source token only.
        // Exact raw offsets must never be approximated to a nearby character.
        if (contains({ ...child, to }) && raw !== value) value = raw;
        text(
          parent,
          value,
          child.from,
          to,
          displayOffsets(value, source.slice(child.from, to), child.from),
        );
      }
    } else
      text(parent, n.text ?? "", n.contentFrom ?? n.from, n.contentTo ?? n.to);
  };
  const atomic = (n: MarkdownNode) => {
    if (n.type === "footnoteRef") {
      const link = element("span", "native-atom");
      bounds(link, n.from, n.to);
      link.contentEditable = "false";
      link.dataset.atom = n.type;
      paintFootnoteReference(link, fragment(n));
      return link;
    }
    const wrap = bounds(element("span", "native-atom"), n.from, n.to);
    wrap.contentEditable = "false";
    wrap.dataset.atom = n.type;
    wrap.tabIndex = readOnly ? -1 : 0;
    wrap.setAttribute("role", "button");
    wrap.setAttribute(
      "aria-label",
      `Edit ${n.type === "mathInline" ? "inline equation" : n.type} source`,
    );
    wrap.innerHTML = fragment(n);
    return wrap;
  };
  const render = (n: MarkdownNode): HTMLElement => {
    let el: HTMLElement;
    switch (n.type) {
      case "editingParagraph": {
        el = element(
          n.kind === "heading" ? (`h${n.level}` as "h1") : "p",
          "native-editing-paragraph",
        );
        if (n.key) el.id = n.key;
        if (n.kind === "heading")
          for (const [key, value] of Object.entries(
            sectionNumberAttributes(
              documentIndex(parsed).sections.get(n.key ?? ""),
            ),
          ))
            el.setAttribute(key, value);
        el.dataset.editingSource = "true";
        const from = n.contentFrom ?? n.from,
          to = n.contentTo ?? n.to;
        text(el, source.slice(from, to), from, to);
        break;
      }
      case "paragraph":
      case "heading":
      case "cell": {
        el = element(
          n.type === "heading"
            ? (`h${n.level}` as "h1")
            : n.type === "cell"
              ? "span"
              : "p",
        );
        if (n.key) el.id = n.key;
        if (n.type === "heading")
          for (const [key, value] of Object.entries(
            sectionNumberAttributes(
              documentIndex(parsed).sections.get(n.key ?? ""),
            ),
          ))
            el.setAttribute(key, value);
        const from = n.contentFrom ?? n.from;
        if (
          focused &&
          [selection.anchor, selection.head].some(
            (at) => at >= lineAt(source, n.from).from && at < from,
          )
        )
          syntax(el, lineAt(source, n.from).from, from);
        if (n.type === "heading" && !n.text?.trim()) {
          const end = lineAt(source, n.from).to;
          text(el, "", end, end);
        } else children(el, n);
        const to = n.contentTo ?? n.to;
        const end = n.to - (source[n.to - 1] === "\n" ? 1 : 0);
        if (
          focused &&
          end > to &&
          [selection.anchor, selection.head].some((at) => at > to && at <= end)
        )
          syntax(el, to, end);
        break;
      }
      case "list": {
        el = element(
          n.ordered ? "ol" : "ul",
          n.tight ? "native-list tight" : "native-list",
        );
        if (n.ordered && n.start) (el as HTMLOListElement).start = n.start;
        children(el, n);
        break;
      }
      case "item": {
        el = element("li");
        let content = el;
        if (n.checked !== undefined) {
          el.classList.add("native-task", "document-task");
          el.dataset.checked = String(n.checked);
          const checkbox = element("input");
          checkbox.type = "checkbox";
          checkbox.checked = n.checked;
          checkbox.disabled = readOnly;
          checkbox.contentEditable = "false";
          checkbox.dataset.taskFrom = String(n.from);
          checkbox.setAttribute(
            "aria-label",
            n.checked ? "Mark task incomplete" : "Complete task",
          );
          el.append(checkbox);
          content = element("div", "document-task-content");
          el.append(content);
        }
        if (n.children?.length) children(content, n);
        else {
          const start =
            source
              .slice(n.from, n.to)
              .match(
                /^(?:[ \t>]*)(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]*)?/,
              )?.[0].length ?? 0;
          text(content, "", n.from + start, n.from + start);
        }
        break;
      }
      case "blockquote":
      case "callout": {
        el = element(
          n.type === "callout" ? "aside" : "blockquote",
          n.type === "callout" ? `callout callout-${n.kind ?? "note"}` : "",
        );
        if (n.type === "callout" && n.children?.[0]?.kind !== "calloutHeader") {
          const title = element("div", "callout-title native-callout-header");
          title.contentEditable = "false";
          title.dataset.nativeUi = "true";
          const label = element("span");
          label.textContent = n.title ?? "Note";
          title.append(label);
          if (!readOnly) {
            const kind = element("select", "native-callout-kind");
            kind.setAttribute("aria-label", "Callout type");
            kind.dataset.calloutFrom = String(n.from);
            kind.dataset.nativeUi = "true";
            for (const value of [
              "note",
              "warning",
              "theorem",
              "lemma",
              "proof",
              "definition",
              "corollary",
              "proposition",
              "example",
              "remark",
            ]) {
              const option = element("option");
              option.value = value;
              option.textContent = value[0].toUpperCase() + value.slice(1);
              option.selected = value === (n.kind ?? "note");
              kind.append(option);
            }
            title.append(kind);
            const field = element("input", "native-callout-title");
            field.value = n.title ?? "";
            field.maxLength = 200;
            field.setAttribute("aria-label", "Callout title");
            field.dataset.metadataFrom = String(n.from);
            field.dataset.metadataType = "callout";
            field.dataset.nativeUi = "true";
            title.append(field);
          }
          el.append(title);
        }
        children(el, n);
        let tail =
          n.children?.at(-1)?.to ?? (source.indexOf("\n", n.from) + 1 || n.to);
        for (const line of source.slice(tail, n.to).split(/(?<=\n)/)) {
          if (/^(?:[ \t]*> ?)+[ \t]*(?:\r?\n)?$/.test(line)) {
            const at = tail + line.replace(/\r?\n$/, "").length;
            const empty = element("p");
            text(empty, "", at, at);
            el.append(empty);
          }
          tail += line.length;
        }
        break;
      }
      case "table": {
        el = element("div", "native-table-block");
        el.dataset.block = "table";
        const table = element("table");
        const model = tableModel(source, n);
        table.setAttribute("aria-label", "Editable table");
        const widths = options.tableWidths?.get(n.from);
        if (widths) {
          const group = element("colgroup");
          widths.forEach((width) => {
            const column = element("col");
            column.style.width = width + "px";
            group.append(column);
          });
          table.append(group);
          table.style.tableLayout = "fixed";
          table.style.minWidth =
            widths.reduce((sum, width) => sum + width, 0) + "px";
        }
        n.children?.forEach((row, rowIndex) => {
          const section =
            rowIndex === 0
              ? element("thead")
              : (table.tBodies[0] ?? element("tbody"));
          const tr = element("tr");
          row.children?.forEach((cell, column) => {
            const field = model?.rows[rowIndex]?.cells[column] ?? cell;
            const td = bounds(
              element(rowIndex === 0 ? "th" : "td"),
              field.from,
              field.to,
            );
            td.dataset.row = String(rowIndex);
            td.dataset.column = String(column);
            td.setAttribute(
              "aria-label",
              `Row ${rowIndex + 1}, column ${column + 1}`,
            );
            if (n.align?.[column]) td.style.textAlign = n.align[column];
            const fieldFrom =
              "fieldFrom" in field ? field.fieldFrom : field.from;
            const fieldTo = "fieldTo" in field ? field.fieldTo : field.to;
            if (
              focused &&
              !readOnly &&
              intersects(selection, fieldFrom, fieldTo) &&
              (selection.anchor !== selection.head ||
                !options.activeCell ||
                (options.activeCell.table === n.from &&
                  options.activeCell.row === rowIndex &&
                  options.activeCell.column === column))
            ) {
              const from = Math.min(
                field.from,
                Math.max(fieldFrom, Math.min(selection.anchor, selection.head)),
              );
              const to = Math.max(
                field.to,
                Math.min(fieldTo, Math.max(selection.anchor, selection.head)),
              );
              td.classList.add("native-editing-cell");
              if (
                from === field.from &&
                to === field.to &&
                cell.children?.length
              )
                children(td, cell);
              else text(td, source.slice(from, to), from, to);
            } else if (cell.children?.length) children(td, cell);
            else text(td, cell.text ?? "", field.from, field.to);
            if (rowIndex === 0) {
              const handle = element("span", "native-column-resizer");
              handle.contentEditable = "false";
              handle.dataset.nativeUi = "true";
              handle.dataset.resizeColumn = String(column);
              handle.tabIndex = 0;
              handle.role = "separator";
              handle.setAttribute("aria-orientation", "vertical");
              handle.setAttribute("aria-label", `Resize column ${column + 1}`);
              handle.setAttribute("aria-valuemin", "64");
              handle.setAttribute("aria-valuemax", "1200");
              handle.setAttribute(
                "aria-valuenow",
                String(widths?.[column] ?? 160),
              );
              td.append(handle);
            }
            if ((column === 0 && rowIndex > 0) || rowIndex === 0) {
              const grip = element("span", "native-table-grip");
              grip.contentEditable = "false";
              grip.dataset.nativeUi = "true";
              grip.draggable = !readOnly;
              grip.dataset.moveAxis = rowIndex === 0 ? "column" : "row";
              grip.dataset.moveIndex = String(
                rowIndex === 0 ? column : rowIndex,
              );
              grip.title =
                rowIndex === 0
                  ? `Drag column ${column + 1}`
                  : `Drag row ${rowIndex + 1}`;
              grip.setAttribute("aria-hidden", "true");
              td.append(grip);
            }
            tr.append(td);
          });
          section.append(tr);
          if (!section.parentElement) table.append(section);
        });
        el.append(table);
        break;
      }
      case "codeBlock": {
        if (
          !source.slice(n.from, n.to).includes("\n") ||
          (n.contentFrom === n.contentTo && n.contentTo === n.to)
        ) {
          el = element("p");
          const value = source.slice(n.from, n.to).replace(/\n$/, "");
          text(el, value, n.from, n.from + value.length);
          break;
        }
        el = element("div", "native-code-block");
        el.dataset.block = "code";
        const header = lineAt(source, n.from);
        if (
          focused &&
          !readOnly &&
          intersects(selection, header.from, header.to)
        ) {
          const draft = element("p", "native-fence-header");
          text(draft, header.text, header.from, header.to);
          el.append(draft);
        }
        const override = options.codeOverrides.get(n.from);
        const wrap = override?.wrap ?? preferences.codeWrap,
          numbers = override?.numbers ?? preferences.codeLineNumbers;
        el.classList.toggle("code-soft-wrap", wrap);
        el.classList.toggle("code-numbered", numbers);
        const body = element("pre", "native-code-body");
        body.spellcheck = false;
        const code = element("code");
        const literal = literalBody(source, n),
          value = literal.text;
        let line = element("span", "native-code-line"),
          lineNumber = 1;
        line.dataset.codeLine = String(lineNumber);
        code.append(line);
        let offset = 0;
        const appendCode = (value: string, classes = "") => {
          value.split("\n").forEach((part, index, parts) => {
            const target = element("span", classes);
            line.append(target);
            const raw = part + (index < parts.length - 1 ? "\n" : "");
            const offsets = literal.offsets.slice(
              offset,
              offset + raw.length + 1,
            );
            text(target, raw, offsets[0], offsets.at(-1), offsets);
            offset += raw.length;
            if (index < parts.length - 1) {
              line = element("span", "native-code-line");
              line.dataset.codeLine = String(++lineNumber);
              code.append(line);
            }
          });
        };
        if (value.length <= 100_000 && n.lang) {
          const highlighted = element("span");
          highlighted.innerHTML = highlightCode(value, n.lang);
          const walk = (parent: Node, classes = "") => {
            for (const child of parent.childNodes) {
              if (child.nodeType === Node.TEXT_NODE) {
                appendCode(child.textContent ?? "", classes);
              } else {
                walk(
                  child,
                  (classes + " " + (child as Element).className).trim(),
                );
              }
            }
          };
          walk(highlighted);
          if (!value) appendCode("");
        } else appendCode(value);
        body.append(code);
        el.append(body);
        const toolbar = element("div", "native-block-tools");
        toolbar.contentEditable = "false";
        toolbar.dataset.nativeUi = "true";
        const language = element("input", "native-code-language");
        language.value = n.lang ?? "";
        language.placeholder = "Plain text";
        language.setAttribute("aria-label", "Code language");
        language.dataset.languageFrom = String(n.from);
        language.disabled = readOnly;
        language.maxLength = 40;
        toolbar.append(
          language,
          ui("Copy code", "copyCode"),
          ui("More code actions", "menu"),
        );
        el.append(toolbar);
        if (n.lang === "mermaid" && !contains(n)) {
          const preview = element("div", "native-diagram-preview");
          preview.contentEditable = "false";
          preview.innerHTML = fragment(n);
          el.append(preview);
        }
        break;
      }
      case "mathBlock": {
        el = element("div", "native-math-block");
        el.dataset.block = "math";
        const literal = literalBody(source, n);
        const header = lineAt(source, n.from);
        if (
          focused &&
          !readOnly &&
          intersects(selection, header.from, header.to)
        ) {
          const draft = element("p", "native-fence-header");
          text(draft, header.text, header.from, header.to);
          el.append(draft);
        }
        if (contains(n) && !readOnly) {
          const tex = element("pre", "native-math-source");
          tex.spellcheck = false;
          tex.setAttribute("aria-label", "Equation TeX source");
          text(
            tex,
            literal.text,
            literal.offsets[0],
            literal.offsets.at(-1),
            literal.offsets,
          );
          el.append(tex);
          el.classList.add("is-editing");
        }
        const preview = element("div", "native-math-preview");
        preview.contentEditable = "false";
        preview.dataset.atom = "mathBlock";
        bounds(preview, literal.offsets[0], literal.offsets.at(-1)!);
        preview.tabIndex = readOnly ? -1 : 0;
        preview.setAttribute("role", "button");
        preview.setAttribute("aria-label", "Edit display equation");
        preview.innerHTML = fragment(n);
        if (!contains(n) || preferences.mathPreview) el.append(preview);
        const toolbar = element("div", "native-block-tools");
        toolbar.contentEditable = "false";
        toolbar.dataset.nativeUi = "true";
        toolbar.append(
          ui("Copy TeX", "copyTex"),
          ui("More equation actions", "menu"),
        );
        if (contains(n)) toolbar.append(ui("Done · ⌘ Enter", "finishBlock"));
        el.append(toolbar);
        break;
      }
      case "hr":
        if (contains(n) && !readOnly) {
          el = element("p", "native-revealed");
          const value = source.slice(n.from, n.to).replace(/\n$/, "");
          text(el, value, n.from, n.from + value.length);
          break;
        }
        el = element("div", "native-divider");
        el.contentEditable = "false";
        el.dataset.atom = "hr";
        el.append(element("hr"));
        break;
      case "text":
        el = element("span");
        text(
          el,
          n.text ?? "",
          n.from,
          n.to,
          displayOffsets(n.text ?? "", source.slice(n.from, n.to), n.from),
        );
        break;
      case "softbreak":
      case "hardbreak":
      case "tableBreak": {
        el = element("span");
        text(el, "\n", n.from, n.to, [n.from, n.to]);
        if (n.type !== "softbreak") el.classList.add("native-hard-break");
        break;
      }
      case "em":
      case "strong":
      case "strike":
      case "highlight":
      case "code":
      case "link":
      case "subscript":
      case "superscript":
      case "underline": {
        const tag = {
          em: "em",
          strong: "strong",
          strike: "del",
          highlight: "mark",
          code: "code",
          link: "a",
          subscript: "sub",
          superscript: "sup",
          underline: "u",
        }[n.type] as "span";
        el = element(tag);
        if (n.type === "link") {
          const href = safeUrl(n.href ?? "");
          if (href) el.setAttribute("href", href);
          if (/^https?:/.test(href)) {
            el.setAttribute("target", "_blank");
            el.setAttribute("rel", "noopener noreferrer");
          }
          if (n.title) el.title = n.title;
        }
        if (contains(n)) {
          el.classList.add("native-revealed");
          const marker =
            n.type === "code"
              ? (source.slice(n.from).match(/^`+/)?.[0].length ?? 1)
              : 0;
          const from =
            n.contentFrom ?? n.children?.[0]?.from ?? n.from + marker;
          const to = n.contentTo ?? n.children?.at(-1)?.to ?? n.to - marker;
          syntax(el, n.from, from);
          if (n.type === "code") text(el, source.slice(from, to), from, to);
          else children(el, n);
          syntax(el, to, n.to);
        } else if (n.type === "code") {
          const marker = source.slice(n.from).match(/^`+/)?.[0].length ?? 1;
          const from = n.from + marker,
            to = n.to - marker;
          const raw = source.slice(from, to).replaceAll("\n", " "),
            value = n.text ?? "";
          const trim =
            raw.length === value.length + 2 && raw.slice(1, -1) === value
              ? 1
              : 0;
          text(
            el,
            value,
            from + trim,
            to - trim,
            sourceOffsets(value, from + trim),
          );
        } else children(el, n);
        break;
      }
      case "mathInline":
      case "image":
      case "wikiLink":
      case "citation":
      case "equationRef":
      case "footnoteRef":
      case "emoji": {
        if (contains(n) && !readOnly) {
          el = element("span", "native-revealed");
          text(el, source.slice(n.from, n.to), n.from, n.to);
        } else el = atomic(n);
        break;
      }
      case "toc": {
        el = element("nav", "native-inline-toc");
        el.contentEditable = "false";
        el.innerHTML = fragment(n);
        break;
      }
      case "frontmatter": {
        el = element("details", "native-frontmatter");
        const summary = element("summary");
        summary.textContent = "Document metadata";
        summary.contentEditable = "false";
        el.append(summary);
        const pre = element("pre");
        text(pre, source.slice(n.from, n.to), n.from, n.to);
        el.append(pre);
        break;
      }
      default:
        el = element("pre", "native-source-block");
        text(
          el,
          source.slice(n.from, n.to).replace(/\n$/, ""),
          n.from,
          source[n.to - 1] === "\n" ? n.to - 1 : n.to,
        );
    }
    return bounds(el, n.from, n.to);
  };
  const rendered = options.sourceMode
    ? element("pre", "native-source-block")
    : render(node);
  if (options.sourceMode) {
    let offset = node.from;
    const lines = source.slice(node.from, node.to).split("\n");
    lines.forEach((value, index) => {
      const line = element("span", "native-source-line");
      const raw = value + (index < lines.length - 1 ? "\n" : "");
      text(line, raw, offset, offset + raw.length);
      rendered.append(line);
      offset += raw.length;
    });
    bounds(rendered, node.from, node.to);
  }
  rendered.dataset.nativeBlock = node.type;
  return {
    element: rendered,
    from: node.from,
    to: node.to,
    raw: source.slice(node.from, node.to),
    signature: "",
    maps,
  };
}
