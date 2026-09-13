import {
  Schema,
  type NodeSpec,
  type MarkSpec,
} from "@milkdown/kit/prose/model";

// No stored source offsets in node attrs: an edit near the top must not invalidate
// every later node view. The projection owns offsets, not the rich document.
export const nodes: Record<string, NodeSpec> = {
  doc: { content: "block+" },
  folded_block: {
    group: "block",
    atom: true,
    isolating: true,
    attrs: {
      label: { default: "Block" },
      summary: { default: "" },
      detail: { default: "" },
    },
    toDOM: (node) => [
      "div",
      { class: "axiom-folded-block", contenteditable: "false" },
      node.attrs.label,
    ],
  },
  paragraph: {
    whitespace: "pre",
    group: "block",
    content: "inline*",
    attrs: { blank: { default: false } },
    toDOM: (node) => [
      "p",
      node.attrs.blank ? { class: "axiom-blank-paragraph" } : {},
      0,
    ],
    parseDOM: [{ tag: "p" }],
  },
  source_prose: {
    whitespace: "pre",
    group: "block",
    content: "inline*",
    attrs: { kind: { default: "paragraph" }, level: { default: 0 } },
    toDOM: (node) => {
      const level =
        node.attrs.kind === "heading" &&
        Number.isInteger(node.attrs.level) &&
        node.attrs.level >= 1 &&
        node.attrs.level <= 6
          ? node.attrs.level
          : 0;
      // Heading typography with real editable Markdown, not a decorative #
      // widget. The projected node and every source offset stay unchanged.
      return [
        level ? "h" + level : "p",
        { class: "axiom-source-prose", "data-source-kind": node.attrs.kind },
        0,
      ];
    },
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
      tag: `h${level}.axiom-source-prose`,
      priority: 60,
      attrs: { kind: "heading", level },
    })),
  },
  heading: {
    whitespace: "pre",
    group: "block",
    content: "inline*",
    defining: true,
    attrs: { level: { default: 1 } },
    toDOM: (n) => ["h" + n.attrs.level, 0],
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
      tag: "h" + level,
      attrs: { level },
    })),
  },
  blockquote: {
    group: "block",
    content: "block+",
    defining: true,
    toDOM: () => ["blockquote", 0],
    parseDOM: [{ tag: "blockquote" }],
  },
  footnote: {
    group: "block",
    content: "block+",
    defining: true,
    isolating: true,
    attrs: { key: { default: "" } },
    toDOM: (node) => [
      "aside",
      {
        class: "axiom-footnote",
        "data-footnote-definition": node.attrs.key,
        "aria-label": "Footnote " + node.attrs.key,
      },
      [
        "div",
        {
          class: "axiom-footnote-title",
          contenteditable: "false",
          "data-footnote-title": "true",
        },
        "[^" + node.attrs.key + "]",
      ],
      ["div", { class: "axiom-footnote-body" }, 0],
    ],
    parseDOM: [
      {
        tag: "aside[data-footnote-definition]",
        contentElement: ".axiom-footnote-body",
        getAttrs: (element) => ({
          key: element.getAttribute("data-footnote-definition") ?? "",
        }),
      },
    ],
  },
  callout: {
    group: "block",
    content: "block+",
    defining: true,
    attrs: { kind: { default: "note" }, title: { default: "" } },
    toDOM: (n) => [
      "aside",
      {
        class: "axiom-callout",
        "data-kind": n.attrs.kind,
        "aria-label": n.attrs.title || n.attrs.kind,
      },
      0,
    ],
  },
  bullet_list: {
    group: "block",
    content: "list_item+",
    toDOM: () => ["ul", 0],
    parseDOM: [{ tag: "ul" }],
  },
  ordered_list: {
    group: "block",
    content: "list_item+",
    attrs: { start: { default: 1 } },
    toDOM: (n) => ["ol", { start: n.attrs.start }, 0],
    parseDOM: [
      {
        tag: "ol",
        getAttrs: (el) => ({ start: Number(el.getAttribute("start") || 1) }),
      },
    ],
  },
  list_item: {
    content: "block+",
    defining: true,
    attrs: { checked: { default: null } },
    toDOM: (n) => [
      "li",
      n.attrs.checked === null
        ? {}
        : { "data-task": String(n.attrs.checked), class: "axiom-task" },
      0,
    ],
    parseDOM: [{ tag: "li" }],
  },
  table: {
    group: "block",
    content: "table_row+",
    isolating: true,
    toDOM: () => ["table", ["tbody", 0]],
    parseDOM: [{ tag: "table" }],
  },
  table_row: {
    content: "table_cell+",
    toDOM: () => ["tr", 0],
    parseDOM: [{ tag: "tr" }],
  },
  table_cell: {
    whitespace: "pre",
    content: "inline*",
    isolating: true,
    attrs: { header: { default: false }, align: { default: "" } },
    toDOM: (n) => [
      n.attrs.header ? "th" : "td",
      { style: n.attrs.align ? `text-align:${n.attrs.align}` : "" },
      0,
    ],
    parseDOM: [{ tag: "td" }, { tag: "th", attrs: { header: true } }],
  },
  embedded: {
    group: "block",
    content: "text*",
    marks: "",
    code: true,
    defining: true,
    isolating: true,
    attrs: { kind: { default: "codeBlock" }, lang: { default: "" } },
    toDOM: (n) => ["pre", { "data-kind": n.attrs.kind }, ["code", 0]],
    parseDOM: [{ tag: "pre" }],
  },
  raw_block: {
    group: "block",
    content: "text*",
    marks: "",
    code: true,
    isolating: true,
    attrs: { kind: { default: "source" } },
    toDOM: () => ["pre", { class: "axiom-raw-block" }, 0],
  },
  text: { group: "inline" },
  inline_preview: {
    inline: true,
    group: "inline",
    atom: true,
    attrs: { kind: { default: "mathInline" }, source: { default: "" } },
    toDOM: (node) => [
      "span",
      { class: "axiom-inline-preview", "data-kind": node.attrs.kind },
      node.attrs.source,
    ],
  },
};
export const marks: Record<string, MarkSpec> = {
  strong: { toDOM: () => ["strong", 0], parseDOM: [{ tag: "strong" }] },
  em: { toDOM: () => ["em", 0], parseDOM: [{ tag: "em" }] },
  strike: { toDOM: () => ["s", 0], parseDOM: [{ tag: "s" }] },
  highlight: { toDOM: () => ["mark", 0], parseDOM: [{ tag: "mark" }] },
  subscript: { toDOM: () => ["sub", 0] },
  superscript: { toDOM: () => ["sup", 0] },
  code: { code: true, toDOM: () => ["code", 0], parseDOM: [{ tag: "code" }] },
  // Destinations are validated by the application's link handler; never inject
  // a raw href into the editing DOM (including javascript/data URLs).
  link: {
    attrs: { target: { default: "" } },
    inclusive: false,
    toDOM: (n) => [
      "span",
      { class: "axiom-inline-link", "data-target": n.attrs.target },
      0,
    ],
  },
  syntax: {
    inclusive: false,
    toDOM: () => ["span", { class: "axiom-syntax" }, 0],
  },
  math: { toDOM: () => ["span", { class: "axiom-inline-tex" }, 0] },
};
export const editorSchema = new Schema({ nodes, marks });
