import { parseMarkdown, type MarkdownNode } from "@axiom/markdown";
import { importPathKey } from "./workspace-import";

export type ImportLinkTarget = { kind: "note" | "file"; id: string };
export function resolveImportTarget(
  href: string,
  path: string,
  targets: Map<string, ImportLinkTarget>,
  literal = false,
) {
  if (!href || /^(?:[a-z][\w+.-]*:|\/|#)/i.test(href)) return undefined;
  let decoded: string;
  try {
    decoded = literal
      ? href
      : decodeURIComponent(href.split("#")[0].split("?")[0]);
  } catch {
    return undefined;
  }
  if (/[\\\u0000-\u001f]/.test(decoded)) return null;
  const parts = path.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else if (part && part !== ".") parts.push(part);
  }
  const key = importPathKey(parts.join("/")),
    candidates = [
      targets.get(key + ".md"),
      targets.get(key + ".markdown"),
    ].filter(Boolean);
  return (
    targets.get(key) ??
    (!/\.[^/]+$/.test(key) && candidates.length === 1
      ? candidates[0]
      : undefined)
  );
}
/** Patch parser-owned destinations; retain implicit wiki labels when assigning IDs. */
export function rewriteImportLinks(
  source: string,
  path: string,
  targets: Map<string, ImportLinkTarget>,
  origins: Map<string, ImportLinkTarget> = new Map(),
) {
  const warnings = new Set<string>();
  const resolve = (href: string) => {
    const originalVersion = /\/api\/v1\/attachments\/([\da-f-]{36})/i.exec(
        href,
      )?.[1],
      originalResource = /^([\da-f-]{36})(?:#|$)/i.exec(href)?.[1],
      imported = originalVersion
        ? origins.get("version:" + originalVersion)
        : originalResource
          ? origins.get("resource:" + originalResource)
          : undefined;
    if (imported)
      return (
        (imported.kind === "note"
          ? imported.id
          : `/api/v1/attachments/${imported.id}`) +
        (href.includes("#") ? href.slice(href.indexOf("#")) : "")
      );
    if ((originalVersion || originalResource) && origins.size)
      warnings.add(`Unresolved original identity in ${path}: ${href}`);
    if (!href || /^(?:[a-z][\w+.-]*:|\/|#|[\da-f-]{36}(?:#|$))/i.test(href))
      return null;
    const hash = href.indexOf("#"),
      fragment = hash < 0 ? "" : href.slice(hash);
    const target = resolveImportTarget(href, path, targets);
    if (target === null) return null;
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
  return {
    body: rewriteMarkdownDestinations(source, resolve, {
      preserveWikiLabels: true,
    }),
    warnings: [...warnings],
  };
}

/** Shared import/export patcher. Explicit labels and surrounding syntax stay intact. */
export function rewriteMarkdownDestinations(
  source: string,
  resolve: (href: string) => string | null | undefined,
  options: { preserveWikiLabels?: boolean } = {},
) {
  const parsed = parseMarkdown(source),
    edits: { from: number; to: number; insert: string }[] = [];
  const visit = (node: MarkdownNode, inTable = false) => {
    const table = inTable || node.type === "table";
    if (
      ["link", "image", "wikiLink", "referenceDefinition"].includes(
        node.type,
      ) &&
      node.hrefFrom !== undefined &&
      node.hrefTo !== undefined
    ) {
      const href = resolve(node.href ?? "");
      if (href && href !== node.href) {
        // A bare [[Methods]] derives its label from the destination. Preserve
        // that label before replacing the path with a stable ID. Explicit
        // aliases (even empty ones) already own their label. Bare original IDs
        // remain implicit so the renderer can use the newly resolved title,
        // rather than freezing an old UUID as the visible alias.
        const preserveLabel =
          options.preserveWikiLabels &&
          node.type === "wikiLink" &&
          node.hrefTo === node.to - 2 &&
          !/^[\da-f-]{36}(?:#.*)?$/i.test(node.href ?? "");
        edits.push({
          from: node.hrefFrom,
          to: node.hrefTo,
          insert:
            href +
            (preserveLabel
              ? `${table ? "\\|" : "|"}${node.text ?? node.href ?? ""}`
              : ""),
        });
      }
    }
    node.children?.forEach((child) => visit(child, table));
  };
  visit(parsed.ast);
  Object.values(parsed.footnotes)
    .flat()
    .forEach((node) => visit(node));
  parsed.definitions?.forEach((node) => visit(node));
  const unique = [
    ...new Map(edits.map((edit) => [`${edit.from}:${edit.to}`, edit])).values(),
  ].sort((a, b) => b.from - a.from);
  let body = source;
  for (const edit of unique)
    body = body.slice(0, edit.from) + edit.insert + body.slice(edit.to);
  return body;
}
