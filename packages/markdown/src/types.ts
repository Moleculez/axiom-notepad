export type Dialect = "commonmark" | "gfm" | "stem-v1";
export interface MarkdownNode {
  type: string;
  from: number;
  to: number;
  children?: MarkdownNode[];
  text?: string;
  level?: number;
  href?: string;
  title?: string;
  lang?: string;
  ordered?: boolean;
  start?: number;
  tight?: boolean;
  align?: string[];
  checked?: boolean;
  kind?: string;
  key?: string;
  label?: string;
  contentFrom?: number;
  contentTo?: number;
  marker?: string;
  open?: boolean;
  close?: boolean;
  count?: number;
}
export interface Diagnostic {
  from: number;
  to: number;
  message: string;
  severity: "warning" | "error";
}
export interface ParsedDocument {
  ast: MarkdownNode;
  diagnostics: Diagnostic[];
  outline: { level: number; text: string; id: string; from: number }[];
  links: { target: string; label: string; from: number; to: number }[];
  citations: string[];
  footnotes: Record<string, MarkdownNode[]>;
  /** Source-only top-level definitions. Not rendered as ordinary AST blocks. */
  definitions?: MarkdownNode[];
}
export interface RenderContext {
  /** Clipboard HTML cannot rely on the application's task-row stylesheet. */
  taskLayout?: "gutter" | "inline";
  /** Application/HTML reading surfaces opt into a locally scrollable table frame. */
  scrollTables?: boolean;
  /** Isolated scratchpads must not load user files or external images. */
  disableImages?: boolean;
  math?: (request: import("./math-contract").MathRequest) => string;
  theme?: "light" | "dark";
  conformance?: boolean;
  document?: ParsedDocument;
  fragment?: boolean;
  resolveLink?: (target: string) => { href: string; title: string } | undefined;
  references?: Record<
    string,
    { title: string; authors?: string; year?: string; url?: string }
  >;
}
export interface TextChange {
  from: number;
  to: number;
  insert: string;
}
