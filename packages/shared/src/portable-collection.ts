import { z } from "zod";
import {
  IMPORT_LIMITS,
  importPath,
  importPathKey,
  importExclusion,
} from "./collection-path";
import { mathProjectSettings } from "./research-tools";
import { mindmapSettingsSchema } from "./mindmap";
import { resourceNameSchema } from "./workspace";

export const COLLECTION_MANIFEST = "axiom-manifest.json";
const path = z.string().max(4096).transform(importPath);
const uuid = z.uuid();
export const portableMetadataSchema = z
  .object({
    name: resourceNameSchema.optional(),
    description: z.string().max(10000).optional(),
    tags: z.array(z.string().max(80)).max(100).optional(),
    originId: uuid.optional(),
    originVersionId: uuid.optional(),
    toolKind: z.enum(["math", "canvas", "text", "image", "mindmap"]).optional(),
    settings: z.record(z.string().max(100), z.unknown()).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.settings !== undefined) {
      const result = (
        value.toolKind === "math"
          ? mathProjectSettings
          : value.toolKind === "mindmap"
            ? mindmapSettingsSchema
            : z.object({}).strict()
      ).safeParse(value.settings);
      if (!result.success)
        ctx.addIssue({
          code: "custom",
          message:
            "Unsupported tool settings. Review or keep the original as an attachment.",
        });
    }
  });
export type PortableMetadata = z.infer<typeof portableMetadataSchema>;
export const collectionDiagnosticSchema = z
  .object({
    severity: z.enum(["info", "warning", "error"]),
    code: z.string().max(100),
    path: z.string().max(4096).optional(),
    message: z.string().max(2000),
  })
  .strict();
export type CollectionDiagnostic = z.infer<typeof collectionDiagnosticSchema>;

/** Keep blocking conversion choices visible when advisory diagnostics are large. */
export function boundedCollectionDiagnostics(
  diagnostics: CollectionDiagnostic[],
): CollectionDiagnostic[] {
  if (diagnostics.length <= 2000) return diagnostics;
  const errors = diagnostics.filter((item) => item.severity === "error");
  if (errors.length >= 2000)
    throw new Error(
      "Too many unresolved collection errors. Import a smaller selection.",
    );
  const advisory = diagnostics.filter((item) => item.severity !== "error");
  return [
    ...errors,
    ...advisory.slice(0, 1999 - errors.length),
    {
      severity: "info",
      code: "diagnostic-summary",
      message: `${diagnostics.length - 1999} additional advisory messages were omitted from this bounded preview. No blocking conversion choices were omitted.`,
    },
  ];
}
export const portableResourceSchema = z
  .object({
    id: uuid,
    parentId: uuid.nullable().default(null),
    kind: z.enum(["folder", "note", "file"]),
    path,
    sourceFormat: z.enum(["markdown", "latex", "text", "canvas"]).optional(),
    metadata: portableMetadataSchema.default({}),
  })
  .strict();
export const portableArtifactSchema = z
  .object({
    path,
    role: z.enum(["source", "asset", "derived", "settings", "original"]),
    resourceId: uuid.optional(),
    versionId: uuid.optional(),
    bytes: z.number().int().nonnegative().max(IMPORT_LIMITS.zipExpandedBytes),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const portableCollectionSchema = z
  .object({
    format: z.literal("axiom-collection"),
    version: z.literal(1),
    scope: z.literal("files-and-metadata"),
    createdAt: z.iso.datetime(),
    resources: z
      .array(portableResourceSchema)
      .min(1)
      .max(IMPORT_LIMITS.zipEntries - 1),
    artifacts: z
      .array(portableArtifactSchema)
      .max(IMPORT_LIMITS.zipEntries - 1),
    diagnostics: z.array(collectionDiagnosticSchema).max(2000).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const paths = new Set<string>(),
      ids = new Set<string>();
    let bytes = 0;
    for (const artifact of value.artifacts) {
      const key = importPathKey(artifact.path);
      if (
        paths.has(key) ||
        importExclusion(artifact.path) ||
        key === COLLECTION_MANIFEST
      )
        ctx.addIssue({
          code: "custom",
          message: "Ambiguous, excluded or reserved collection artifact path.",
        });
      paths.add(key);
      bytes += artifact.bytes;
    }
    if (bytes > IMPORT_LIMITS.zipExpandedBytes)
      ctx.addIssue({
        code: "custom",
        message: "Collection exceeds 100 MB expanded.",
      });
    const resourcePaths = new Set<string>();
    for (const resource of value.resources) {
      const key = importPathKey(resource.path);
      if (
        ids.has(resource.id) ||
        resourcePaths.has(key) ||
        importExclusion(resource.path) ||
        key === COLLECTION_MANIFEST
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Collection identities and resource paths must be unique and safe.",
        });
      ids.add(resource.id);
      resourcePaths.add(key);
      if (
        resource.kind !== "folder" &&
        !value.artifacts.some(
          (a) =>
            a.path === resource.path &&
            a.resourceId === resource.id &&
            ["source", "asset"].includes(a.role),
        )
      )
        ctx.addIssue({
          code: "custom",
          message: "Every file/document needs one declared primary artifact.",
        });
      if ((resource.kind === "note") !== !!resource.sourceFormat)
        ctx.addIssue({
          code: "custom",
          message: "Only native documents may declare a source format.",
        });
      const expected = {
        math: "latex",
        canvas: "canvas",
        text: "text",
        image: undefined,
        mindmap: "markdown",
      };
      if (
        resource.metadata.toolKind &&
        (resource.metadata.toolKind === "image"
          ? resource.kind !== "file"
          : resource.sourceFormat !== expected[resource.metadata.toolKind])
      )
        ctx.addIssue({
          code: "custom",
          message: "Tool kind does not match the resource format.",
        });
    }
    for (const resource of value.resources)
      if (resource.parentId && !ids.has(resource.parentId))
        ctx.addIssue({
          code: "custom",
          message: "Collection parent is missing.",
        });
    const byId = new Map(value.resources.map((r) => [r.id, r]));
    const assetVersions = new Set<string>();
    for (const artifact of value.artifacts) {
      if (artifact.role === "asset" && artifact.versionId) {
        if (assetVersions.has(artifact.versionId))
          ctx.addIssue({
            code: "custom",
            message: "Included asset version identities must be unique.",
          });
        assetVersions.add(artifact.versionId);
      }
      if (artifact.resourceId && !byId.has(artifact.resourceId))
        ctx.addIssue({
          code: "custom",
          message: "Artifact resource is missing.",
        });
      const resource = artifact.resourceId
        ? byId.get(artifact.resourceId)
        : undefined;
      if (
        ["source", "asset"].includes(artifact.role) &&
        (!resource ||
          resource.path !== artifact.path ||
          (resource.kind === "note"
            ? artifact.role !== "source"
            : resource.kind !== "file" || artifact.role !== "asset"))
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Primary artifact must match its native source or immutable file.",
        });
    }
    for (const resource of value.resources) {
      const parents = new Set([resource.id]);
      let parent = resource.parentId;
      while (parent) {
        if (parents.has(parent) || parents.size > IMPORT_LIMITS.depth) {
          ctx.addIssue({
            code: "custom",
            message:
              "Collection hierarchy contains a cycle or exceeds its depth budget.",
          });
          break;
        }
        parents.add(parent);
        parent = byId.get(parent)?.parentId ?? null;
      }
    }
  });
export type PortableCollectionManifest = z.infer<
  typeof portableCollectionSchema
>;
export type PortableResource = z.infer<typeof portableResourceSchema>;
export type PortableArtifact = z.infer<typeof portableArtifactSchema>;

/** Imported settings never select global themes or execute project configuration. */
export function portableToolSettings(
  kind: PortableMetadata["toolKind"],
  value: unknown,
) {
  return kind === "math"
    ? mathProjectSettings.parse(value ?? {})
    : kind === "mindmap"
      ? mindmapSettingsSchema.parse(value ?? {})
      : z
          .object({})
          .strict()
          .parse(value ?? {});
}

export function collectionRelativePath(from: string, to: string) {
  const source = from.split("/").slice(0, -1),
    target = to.split("/");
  while (source.length && target.length && source[0] === target[0]) {
    source.shift();
    target.shift();
  }
  return [...source.map(() => ".."), ...target].join("/");
}

/** Markdown destinations are URLs; Canvas file paths are literal paths. */
export function collectionLinkPath(from: string, to: string) {
  return collectionRelativePath(from, to)
    .split("/")
    .map((part) =>
      encodeURIComponent(part).replace(
        /[!'()*]/g,
        (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase(),
      ),
    )
    .join("/");
}
