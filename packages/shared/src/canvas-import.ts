import { parseCanvas, type CanvasData } from "./canvas";
import {
  rewriteImportLinks,
  resolveImportTarget,
  type ImportLinkTarget,
} from "./workspace-import-links";

const nodeFields = new Set([
  "id",
  "type",
  "title",
  "tags",
  "locked",
  "heightMode",
  "fit",
  "previewPage",
  "x",
  "y",
  "width",
  "height",
  "color",
  "text",
  "file",
  "subpath",
  "resourceId",
  "versionId",
  "url",
  "label",
  "background",
  "backgroundStyle",
]);
const edgeFields = new Set([
  "id",
  "fromNode",
  "toNode",
  "fromSide",
  "toSide",
  "fromEnd",
  "toEnd",
  "label",
  "color",
]);
/** External identities are data, never live resource lookups or collaboration IDs. */
export function rewriteImportedCanvas(
  source: string,
  path: string,
  targets: Map<string, ImportLinkTarget>,
  origins: Map<string, ImportLinkTarget>,
  createId: () => string,
) {
  const data = parseCanvas(source.replace(/^\ufeff/, "")),
    ids = new Map(data.nodes.map((n) => [n.id, createId()]));
  const warnings = new Set<string>();
  if (
    Object.keys(data).some(
      (key) => !["schemaVersion", "nodes", "edges"].includes(key),
    )
  )
    warnings.add(
      `Unsupported Canvas document metadata in ${path} is retained only in the exact original source.`,
    );
  const pick = (value: Record<string, unknown>, fields: Set<string>) => {
    if (Object.keys(value).some((k) => !fields.has(k)))
      warnings.add(
        `Unsupported Canvas metadata in ${path} is not applied. Exact original source is retained.`,
      );
    return Object.fromEntries(
      Object.entries(value).filter(([k]) => fields.has(k)),
    );
  };
  const result: CanvasData = {
    schemaVersion: 1,
    nodes: data.nodes.map((node) => {
      const value = {
        ...pick(node, nodeFields),
        id: ids.get(node.id)!,
        heightMode: "manual",
      } as typeof node;
      if (value.type === "text") {
        const rewritten = rewriteImportLinks(
          value.text,
          path,
          targets,
          origins,
        );
        value.text = rewritten.body;
        rewritten.warnings.forEach((w) => warnings.add(w));
      }
      if (value.type === "file") {
        const target =
          (value.versionId
            ? origins.get("version:" + value.versionId)
            : undefined) ??
          (value.resourceId
            ? origins.get("resource:" + value.resourceId)
            : undefined) ??
          resolveImportTarget(value.file, path, targets, true);
        delete value.resourceId;
        delete value.versionId;
        if (target) {
          value.resourceId = target.id;
          if (target.kind === "file") value.versionId = target.id;
        } else
          warnings.add(
            `Unresolved Canvas file in ${path}: ${value.file}. No original resource authority was retained.`,
          );
      }
      if (value.type === "group" && value.background) {
        const version = /\/api\/v1\/attachments\/([\da-f-]{36})/i.exec(
          value.background,
        )?.[1];
        const target =
          (version ? origins.get("version:" + version) : undefined) ??
          resolveImportTarget(value.background, path, targets, true);
        if (target?.kind === "file")
          value.background = `/api/v1/attachments/${target.id}`;
        else {
          delete value.background;
          warnings.add(
            `Canvas background in ${path} was not included; no external media was loaded.`,
          );
        }
      }
      return value;
    }),
    edges: data.edges.map(
      (edge) =>
        ({
          ...pick(edge, edgeFields),
          id: createId(),
          fromNode: ids.get(edge.fromNode)!,
          toNode: ids.get(edge.toNode)!,
        }) as typeof edge,
    ),
  };
  return { body: JSON.stringify(result), warnings: [...warnings] };
}
