import {
  parseMarkdown,
  safeUrl,
  normalizeReferenceLabel,
  type MarkdownNode,
  type ParsedDocument,
  type TextChange,
} from "@axiom/markdown";

export type DefinitionField = "key" | "href" | "title";
export type DefinitionValue = { from: number; to: number; value: string };
export const referenceKey = normalizeReferenceLabel;

/** Exact token ranges, including delimiters. Untouched fields, spacing, CRLF
 * and quote styles are never serialized. Only canonical parser nodes qualify. */
export function linkDefinitionModel(source: string, node: MarkdownNode) {
  if (node.type !== "referenceDefinition") return null;
  const raw = source.slice(node.from, node.to);
  const head =
    /^ {0,3}\[((?:\\.|[^\]\\]){1,999})\]:[ \t]*(?:\r?\n[ \t]*)?/.exec(raw);
  if (!head) return null;
  const keyFrom = node.from + raw.indexOf("[") + 1;
  let end = head[0].length;
  const start = end;
  if (raw[start] === "<") {
    end++;
    while (end < raw.length) {
      if (raw[end] === "\\" && /[\\<>]/.test(raw[end + 1] ?? "")) end += 2;
      else if (raw[end++] === ">") break;
    }
  } else {
    while (end < raw.length && !/[\s\u0000-\u001f]/.test(raw[end])) {
      if (raw[end] === "\\" && raw[end + 1]) end++;
      end++;
    }
  }
  const hrefTo = node.from + end;
  const gap = /^[ \t]*(?:\r?\n[ \t]*)?/.exec(raw.slice(end))![0];
  const titleFrom = end + gap.length;
  let titleEnd = titleFrom;
  if (node.title !== undefined) {
    const close = raw[titleFrom] === "(" ? ")" : raw[titleFrom];
    titleEnd++;
    while (titleEnd < raw.length) {
      if (raw[titleEnd] === "\\" && raw[titleEnd + 1]) titleEnd += 2;
      else if (raw[titleEnd++] === close) break;
    }
  }
  return {
    key: {
      from: keyFrom,
      to: keyFrom + head[1].length,
      value: node.key ?? head[1],
    },
    href: { from: node.from + start, to: hrefTo, value: node.href ?? "" },
    title: {
      from: node.title === undefined ? hrefTo : node.from + titleFrom,
      to: node.title === undefined ? hrefTo : node.from + titleEnd,
      value: node.title ?? "",
    },
  } satisfies Record<DefinitionField, DefinitionValue>;
}

/** Walk semantic links, not source-wide regexes: code, escapes and ordinary
 * inline links must not become accidental rename targets. */
export function linkDefinitionUses(source: string, parsed: ParsedDocument) {
  const uses = new Map<string, { from: number; to: number; at: number }[]>();
  const seen = new Set<number>();
  const visit = (node: MarkdownNode) => {
    if (
      (node.type === "link" || node.type === "image") &&
      node.contentTo !== undefined
    ) {
      const tail = source.slice(node.contentTo + 1, node.to);
      const explicit = /^\[((?:\\.|[^\]\\])*)\]$/.exec(tail);
      if (explicit || !tail) {
        const key = referenceKey(
          explicit?.[1] || source.slice(node.contentFrom, node.contentTo),
        );
        if (!seen.has(node.from)) {
          seen.add(node.from);
          const items = uses.get(key) ?? [];
          items.push({ from: node.contentTo + 1, to: node.to, at: node.from });
          uses.set(key, items);
        }
      }
    }
    node.children?.forEach(visit);
  };
  visit(parsed.ast);
  Object.values(parsed.footnotes).flat().forEach(visit);
  return uses;
}

const escaped = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/&/g, "&amp;");

/** One field commit; renaming an ID also rebinds full, collapsed and shortcut
 * links/images in the same undo transaction, without changing their captions. */
export function editLinkDefinition(
  source: string,
  parsed: ParsedDocument,
  node: MarkdownNode,
  field: DefinitionField,
  value: string,
):
  | { changes: TextChange[]; error?: undefined }
  | { error: string; changes?: undefined } {
  const model = linkDefinitionModel(source, node);
  if (!model) return { error: "This link definition is no longer available." };
  if (value === model[field].value) return { changes: [] };
  const token = model[field];
  let insert = value;
  const changes: TextChange[] = [];
  if (field === "key") {
    if (
      !referenceKey(value) ||
      value.length > 999 ||
      value.startsWith("^") ||
      /[\r\n]/.test(value) ||
      /(?<!\\)[\[\]]/.test(value)
    )
      return {
        error: "Use a nonempty reference ID without brackets or line breaks.",
      };
    const duplicates = parsed.definitions?.filter(
      (n) => n.type === "referenceDefinition" && n.from !== node.from,
    );
    if (
      duplicates?.some((n) => referenceKey(n.key ?? "") === referenceKey(value))
    )
      return { error: "Another link definition already uses this ID." };
    if (referenceKey(value) !== referenceKey(model.key.value)) {
      if (
        duplicates?.some(
          (n) => referenceKey(n.key ?? "") === referenceKey(model.key.value),
        )
      )
        return {
          error:
            "Resolve the duplicate definition in Source mode before renaming this ID.",
        };
      for (const use of linkDefinitionUses(source, parsed).get(
        referenceKey(model.key.value),
      ) ?? [])
        changes.push({ from: use.from, to: use.to, insert: `[${value}]` });
    }
  } else if (field === "href") {
    if (/[\r\n\u0000-\u001f\u007f]/.test(value) || (value && !safeUrl(value)))
      return {
        error: "Use an https, http, mailto, anchor, or relative destination.",
      };
    const encoded = escaped(value).replace(/[<>]/g, "\\$&");
    const original = source.slice(token.from, token.to);
    // Preserve the authored destination style unless angle brackets are needed.
    insert =
      original.startsWith("<") || !value || /[\s()<>]/.test(value)
        ? `<${encoded}>`
        : encoded;
  } else {
    if (/\r|\n[ \t]*\n|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
      return {
        error: "A link title cannot contain blank lines or control characters.",
      };
    if (!value) {
      // Removing a multiline title also removes its separator, not a neighbor.
      return { changes: [{ from: model.href.to, to: token.to, insert: "" }] };
    }
    const open =
      source[token.from] === "'" ? "'" : source[token.from] === "(" ? "(" : '"';
    const close = open === "(" ? ")" : open;
    insert =
      (node.title === undefined ? " " : "") +
      open +
      escaped(value).replace(
        open === "(" ? /[()]/g : open === "'" ? /'/g : /"/g,
        "\\$&",
      ) +
      close;
    if (source.slice(node.from, node.to).includes("\r\n"))
      insert = insert.replace(/\n/g, "\r\n");
  }
  changes.push({ from: token.from, to: token.to, insert });
  // The canonical parser is the final authority, including unusual escaping.
  const local =
    source.slice(node.from, token.from) +
    insert +
    source.slice(token.to, node.to);
  const check = parseMarkdown(local).definitions?.find(
    (n) => n.type === "referenceDefinition",
  );
  if (!check || check[field] !== value)
    return {
      error: "This value cannot be represented as a Markdown link definition.",
    };
  return { changes: changes.sort((a, b) => a.from - b.from) };
}
