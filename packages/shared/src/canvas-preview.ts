import type { FilePreviewManifest } from "./file-preview";
import type { Resource } from "./workspace";
import type { DocumentFormat } from "./document-format";

/** Private source belongs to the reader's cache, never to a shared file card. */
export type ResourceCardPreview = {
  resource: Resource;
  revision: string;
} & (
  | { kind: "file"; file: FilePreviewManifest }
  | {
      kind: "document";
      format: DocumentFormat;
      source: string;
      settings: Record<string, unknown>;
    }
);

export function embeddableCanvasUrl(
  value: string,
  appOrigin: string,
): string | null {
  try {
    const u = new URL(value);
    if (
      u.protocol !== "https:" ||
      u.origin === appOrigin ||
      u.username ||
      u.password
    )
      return null;
    const host = u.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.includes(":") ||
      /^\d+(\.\d+)*$/.test(host)
    )
      return null;
    return u.href;
  } catch {
    return null;
  }
}
