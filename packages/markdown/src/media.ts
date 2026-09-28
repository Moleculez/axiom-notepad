import type { MarkdownNode, ParsedDocument } from "./types";

/** Portable content is always ordinary Markdown; comments only add presentation. */
export type MediaMetadata = {
  v: 1;
  display: "image" | "card" | "preview" | "figure";
  label?: string;
  width?: number;
  align?: "left" | "center" | "right";
  mime?: string;
};
export function mediaMetadata(value: unknown): MediaMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    v.v !== 1 ||
    !["image", "card", "preview", "figure"].includes(String(v.display))
  )
    return null;
  if (
    Object.keys(v).some(
      (key) =>
        !["v", "display", "label", "width", "align", "mime"].includes(key),
    )
  )
    return null;
  if (
    v.label !== undefined &&
    (typeof v.label !== "string" || !/^fig-[a-zA-Z0-9_-]{1,80}$/.test(v.label))
  )
    return null;
  if (
    v.width !== undefined &&
    (typeof v.width !== "number" ||
      !Number.isFinite(v.width) ||
      v.width < 10 ||
      v.width > 100)
  )
    return null;
  if (
    v.align !== undefined &&
    !["left", "center", "right"].includes(String(v.align))
  )
    return null;
  if (
    v.mime !== undefined &&
    (typeof v.mime !== "string" ||
      !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(v.mime))
  )
    return null;
  return {
    v: 1,
    display: v.display as MediaMetadata["display"],
    ...(v.label ? { label: v.label as string } : {}),
    ...(v.width !== undefined ? { width: v.width as number } : {}),
    ...(v.align ? { align: v.align as MediaMetadata["align"] } : {}),
    ...(v.mime ? { mime: v.mime as string } : {}),
  };
}
export function mediaMarkdown(
  link: string,
  metadata: MediaMetadata,
  caption = "",
) {
  if (!mediaMetadata(metadata)) throw new Error("Invalid media presentation.");
  if (/<!--\s*\/?axiom-media\b/i.test(link + caption))
    throw new Error("Media captions cannot contain media wrappers.");
  return `<!-- axiom-media ${JSON.stringify(metadata)} -->\n\n${link.trim()}${caption.trim() ? "\n\n" + caption.trim() : ""}\n\n<!-- /axiom-media -->`;
}
export function mediaAsset(node: MarkdownNode): MarkdownNode | undefined {
  const first = node.children?.[0];
  return first?.type === "paragraph" &&
    first.children?.length === 1 &&
    ["image", "link"].includes(first.children[0].type)
    ? first.children[0]
    : undefined;
}
/** A linear AST pass: wrappers cannot capture a following block or nest. */
export function collectMedia(document: ParsedDocument) {
  const figures = new Map<string, number>();
  let number = 0;
  const transform = (nodes: MarkdownNode[]): MarkdownNode[] => {
    const result: MarkdownNode[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const opener =
        node.type === "htmlBlock" &&
        /^<!-- axiom-media (.{1,1024}) -->\s*$/.exec(node.text ?? "");
      if (opener) {
        let metadata: MediaMetadata | null = null;
        try {
          metadata = mediaMetadata(JSON.parse(opener[1]));
        } catch {
          /* Retain invalid source. */
        }
        let end = i + 1;
        while (end < nodes.length && nodes[end].type !== "htmlBlock") end++;
        const closed =
          end < nodes.length &&
          /^<!-- \/axiom-media -->\s*$/.test(nodes[end].text ?? "");
        const media: MarkdownNode = {
          type: "media",
          from: node.from,
          to: nodes[end]?.to ?? node.to,
          children: nodes.slice(i + 1, end),
          media: metadata ?? undefined,
        };
        if (metadata && closed && mediaAsset(media)) {
          if (metadata.display === "figure") {
            media.count = ++number;
            if (metadata.label) {
              if (figures.has(metadata.label))
                document.diagnostics.push({
                  from: node.from,
                  to: node.to,
                  severity: "warning",
                  message: `Duplicate figure label: ${metadata.label}`,
                });
              else {
                figures.set(metadata.label, number);
                media.key = metadata.label;
              }
            }
          }
          result.push(media);
          i = end;
          continue;
        }
        document.diagnostics.push({
          from: node.from,
          to: node.to,
          severity: "warning",
          message:
            "Invalid or incomplete media wrapper; its Markdown is preserved.",
        });
      }
      if (node.children) node.children = transform(node.children);
      result.push(node);
    }
    return result;
  };
  document.ast.children = transform(document.ast.children ?? []);
  for (const key of Object.keys(document.footnotes)) {
    document.footnotes[key] = transform(document.footnotes[key]);
    const definition = document.definitions?.find(
      (node) => node.type === "footnoteDefinition" && node.key === key,
    );
    if (definition) definition.children = document.footnotes[key];
  }
  document.figures = Object.fromEntries(figures);
  for (const link of document.links)
    if (link.target.startsWith("#fig-") && !figures.has(link.target.slice(1)))
      document.diagnostics.push({
        from: link.from,
        to: link.to,
        severity: "warning",
        message: `Unresolved figure reference: ${link.target.slice(1)}`,
      });
}
export function attachmentVersion(href: string) {
  return (
    /^\/api\/v1\/attachments\/([a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12})(?:[?#]|$)/i
      .exec(href)?.[1]
      ?.toLowerCase() ?? null
  );
}
export function documentAssets(document: ParsedDocument) {
  const assets: { node: MarkdownNode; versionId: string | null }[] = [];
  const visit = (node: MarkdownNode) => {
    if (node.type === "image" || node.type === "link")
      assets.push({ node, versionId: attachmentVersion(node.href ?? "") });
    node.children?.forEach(visit);
  };
  visit(document.ast);
  Object.values(document.footnotes).forEach((nodes) => nodes.forEach(visit));
  return assets;
}
