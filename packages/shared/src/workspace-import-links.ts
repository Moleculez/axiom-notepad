import { parseMarkdown, type MarkdownNode } from "@axiom/markdown";
import { importPathKey } from "./workspace-import";

export type ImportLinkTarget = { kind: "note" | "file"; id: string };
/** Patch parser-owned destination spans only. Code, labels, titles, whitespace and line endings stay intact. */
export function rewriteImportLinks(
  source: string,
  path: string,
  targets: Map<string, ImportLinkTarget>,
) {
  const parsed = parseMarkdown(source),
    edits: { from: number; to: number; insert: string }[] = [],
    warnings = new Set<string>();
  const resolve = (href: string) => {
    if (!href || /^(?:[a-z][\w+.-]*:|\/|#|[\da-f-]{36}(?:#|$))/i.test(href))
      return null;
    const hash = href.indexOf("#"),
      fragment = hash < 0 ? "" : href.slice(hash);
    const pathname = (hash < 0 ? href : href.slice(0, hash)).split("?")[0];
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      warnings.add(`Unresolved link in ${path}: ${href}`);
      return null;
    }
    if (/[\\\u0000-\u001f]/.test(decoded) || decoded.startsWith("/"))
      return null;
    const parts = path.split("/").slice(0, -1);
    for (const part of decoded.split("/")) {
      if (part === "..") {
        if (!parts.length) return null;
        parts.pop();
      } else if (part && part !== ".") parts.push(part);
    }
    const key = importPathKey(parts.join("/"));
    const candidates = [
      targets.get(key + ".md"),
      targets.get(key + ".markdown"),
    ].filter(Boolean);
    const target =
      targets.get(key) ??
      (!/\.[^/]+$/.test(key) && candidates.length === 1
        ? candidates[0]
        : undefined);
    if (!target) {
      warnings.add(`Unresolved link in ${path}: ${href}`);
      return null;
    }
    return (
      (target.kind === "note"
        ? target.id
        : `/api/v1/attachments/${target.id}`) + fragment
    );
  };
  const visit = (node: MarkdownNode) => {
    if (
      ["link", "image", "wikiLink", "referenceDefinition"].includes(
        node.type,
      ) &&
      node.hrefFrom !== undefined &&
      node.hrefTo !== undefined
    ) {
      const href = resolve(node.href ?? "");
      if (href)
        edits.push({ from: node.hrefFrom, to: node.hrefTo, insert: href });
    }
    node.children?.forEach(visit);
  };
  visit(parsed.ast);
  Object.values(parsed.footnotes).flat().forEach(visit);
  parsed.definitions?.forEach(visit);
  const unique = [
    ...new Map(edits.map((edit) => [`${edit.from}:${edit.to}`, edit])).values(),
  ].sort((a, b) => b.from - a.from);
  let body = source;
  for (const edit of unique)
    body = body.slice(0, edit.from) + edit.insert + body.slice(edit.to);
  return { body, warnings: [...warnings] };
}
