import {
  plainText,
  safeUrl,
  type MarkdownNode,
  type ParsedDocument,
} from "@axiom/markdown";
import type {
  VisualPlacement,
  VisualSource,
} from "@axiom/shared/visual-annotations";
import type { Resource } from "@axiom/shared/workspace";

export type VisualAsset = {
  id: string;
  kind: "image" | "mermaid";
  name: string;
  url?: string;
  markdown?: string;
  source?: string;
  svg?: string;
  state?: "ready" | "stale" | "error";
  width?: number;
  height?: number;
  bytes?: number;
  mime?: string;
  placement?: VisualPlacement;
  fingerprint?: string;
  from?: number;
  to?: number;
};
export type VisualRequest = {
  items: VisualAsset[];
  index: number;
  restore?: () => void;
  current?: () => VisualAsset[];
  initialPanel?: "info" | "markup";
};
export const visualOpenEvent = "axiom:visual-open";
export function fileVisuals(files: Resource[]): VisualAsset[] {
  return files.flatMap((file) =>
    file.kind === "file" &&
    !file.deleted_at &&
    file.current_version_id &&
    file.mime?.startsWith("image/")
      ? [
          {
            id: file.id,
            kind: "image",
            name: file.name,
            url: `/api/v1/attachments/${file.current_version_id}`,
            mime: file.mime,
            bytes: file.bytes,
            placement: {
              resourceId: file.id,
              versionId: file.current_version_id,
              path: [],
            },
          },
        ]
      : [],
  );
}
export function openVisual(request: VisualRequest) {
  window.dispatchEvent(
    new CustomEvent<VisualRequest>(visualOpenEvent, { detail: request }),
  );
}
export function visualNodes(parsed: ParsedDocument): MarkdownNode[] {
  const result: MarkdownNode[] = [];
  const visit = (n: MarkdownNode) => {
    if (n.type === "image" || (n.type === "codeBlock" && n.lang === "mermaid"))
      result.push(n);
    n.children?.forEach(visit);
  };
  visit(parsed.ast);
  parsed.definitions?.forEach(visit);
  return result
    .sort((a, b) => a.from - b.from)
    .filter((n, i, a) => i === 0 || n.from !== a[i - 1].from);
}
export function markdownVisuals(
  parsed: ParsedDocument,
  source: string,
  placement?: (node: MarkdownNode) => VisualPlacement | undefined,
): VisualAsset[] {
  return visualNodes(parsed).flatMap((n) => {
    const url = n.type === "image" ? safeUrl(n.href ?? "", true) : undefined;
    if (n.type === "image" && !url) return [];
    const located = placement?.(n);
    // Attachment versions are permission-checked alongside their document.
    const version = url?.match(
      /^\/api\/v1\/attachments\/([a-f\d-]{36})(?:[/?#]|$)/i,
    )?.[1];
    if (located && version) located.versionId = version;
    return [
      {
        id: `${n.type}:${n.from}`,
        kind: n.type === "image" ? ("image" as const) : ("mermaid" as const),
        name: (n.type === "image"
          ? plainText(n) || n.title || "Image"
          : "Mermaid diagram"
        ).slice(0, 300),
        from: n.from,
        to: n.to,
        url,
        source: n.text,
        markdown: source.slice(n.from, n.to),
        placement: located,
      },
    ];
  });
}
export async function visualDigest(
  value: string | ArrayBuffer,
): Promise<string> {
  const input =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function visualIdentity(
  asset: VisualAsset,
  width: number,
  height: number,
  fingerprint: string,
  verified: boolean,
): VisualSource {
  return {
    kind: asset.kind,
    label: asset.name.slice(0, 300),
    width,
    height,
    fingerprint,
    verified,
  };
}
