import { z } from "zod";
import { HttpError, resourceAccess, spaceAccess } from "./access";
import { withAuditContext } from "./audit-context";
import { query } from "./db";
import {
  activeConnection,
  connectionAllowsSpace,
  type IntegrationConnection,
} from "./integration-security";
import { researchLibraryApi } from "./research-library-api";
import { researchGraphApi } from "./research-graph-api";
import { readVisualAnnotations } from "./visual-annotations-api";
import { readPaperAnnotations } from "./research-api";
import { liveResource } from "./research-library-service";

const uuid = z.uuid();
const page = {
  cursor: z.coerce.number().int().min(0).max(1_000_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
};
const workspace = z.object({ spaceId: uuid }).strict();
const reference = workspace.extend({ id: uuid });
const listSchema = workspace.extend({
  query: z
    .object({
      ...page,
      q: z.string().max(200).default(""),
      author: z.string().max(200).default(""),
      year: z.string().max(20).default(""),
      tag: z.string().max(80).default(""),
      collection: z
        .union([uuid, z.literal("unfiled"), z.literal("")])
        .default(""),
      status: z
        .enum(["all", "want", "reading", "read", "archived"])
        .default("all"),
      filter: z.enum(["all", "duplicates", "trash"]).default("all"),
      sort: z
        .enum(["title", "authors", "year", "venue", "updated_at"])
        .default("updated_at"),
      direction: z.enum(["asc", "desc"]).default("desc"),
    })
    .strict()
    .prefault({}),
});
const collectionsSchema = workspace.extend({
  query: z.object(page).strict().prefault({}),
});
const provenanceSchema = reference.extend({
  query: z.object({ cursor: uuid.optional() }).strict().prefault({}),
});
const graphSchema = workspace.extend({
  query: z
    .object({
      tag: z.string().max(80).optional(),
      collection: uuid.optional(),
      types: z
        .array(z.enum(["note", "reference", "pdf"]))
        .min(1)
        .max(3)
        .optional(),
    })
    .strict()
    .prefault({}),
});
const annotationsSchema = reference.extend({
  query: z
    .object({
      ...page,
      kind: z.enum(["visual", "pdf"]).default("visual"),
      versionId: uuid.optional(),
    })
    .strict()
    .prefault({}),
});
const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
export const researchIntegrationTools = [
  {
    name: "workspace_references_list",
    description:
      "List references in one granted workspace with bounded filters and pagination. Linked evidence counts never include other workspaces.",
    inputSchema: listSchema,
    annotations,
  },
  {
    name: "workspace_reference_read",
    description:
      "Read a reference, citation metadata and linked note/PDF evidence within one granted workspace. Private owner restrictions remain in effect.",
    inputSchema: reference,
    annotations,
  },
  {
    name: "workspace_reference_collections",
    description: "List bounded reference collections in one granted workspace.",
    inputSchema: collectionsSchema,
    annotations,
  },
  {
    name: "workspace_reference_provenance",
    description:
      "Read a reference's versioned provenance summary without internal provider/import payloads.",
    inputSchema: provenanceSchema,
    annotations,
  },
  {
    name: "workspace_knowledge_graph",
    description:
      "Read the bounded note, reference and PDF graph for one granted workspace; every returned edge connects visible nodes.",
    inputSchema: graphSchema,
    annotations,
  },
  {
    name: "resource_annotations_read",
    description:
      "Read visible image/diagram annotations or PDF annotations for a resource in one granted workspace. Private annotations are visible only to their owner.",
    inputSchema: annotationsSchema,
    annotations,
  },
] as const;

/** Intentional field whitelist: provider/import data is never MCP evidence. */
export function presentIntegrationReference(value: Record<string, unknown>) {
  const keys = [
    "id",
    "space_id",
    "canonical_id",
    "cite_key",
    "title",
    "authors",
    "year",
    "url",
    "doi",
    "arxiv",
    "venue",
    "tags",
    "version",
    "created_at",
    "updated_at",
    "deleted_at",
    "merged_into",
    "collections",
    "status",
    "note_count",
    "pdf_count",
    "bibtex",
  ];
  const result: Record<string, unknown> = {};
  const truncatedFields: string[] = [];
  for (const key of keys) {
    const item = value[key];
    if (typeof item === "string" && item.length > 100_000) {
      result[key] = item.slice(0, 100_000);
      truncatedFields.push(key);
    } else if (item !== undefined) result[key] = item;
  }
  if (truncatedFields.length) result.truncatedFields = truncatedFields;
  return result;
}
export function presentIntegrationProvenance(value: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const key of [
    "id",
    "reference_id",
    "version",
    "kind",
    "created_at",
    "actor",
  ])
    if (value[key] !== undefined) result[key] = value[key];
  for (const key of ["before_data", "after_data"]) {
    const data = value[key];
    result[key] =
      data && typeof data === "object" && !Array.isArray(data)
        ? presentIntegrationReference(data as Record<string, unknown>)
        : null;
  }
  return result;
}
const collectionFields = (value: Record<string, unknown>) =>
  Object.fromEntries(
    ["id", "name", "parent_id", "version", "count"]
      .filter((k) => value[k] !== undefined)
      .map((k) => [k, value[k]]),
  );

async function authorizedWorkspace(
  connection: IntegrationConnection,
  spaceId: string,
) {
  const live = await activeConnection(
    connection.id,
    connection.user_id,
    "workspace:read",
    undefined,
    connection.grant_version,
  );
  if (live.client_id !== connection.client_id)
    throw new HttpError(403, "The connected application's identity changed.");
  connectionAllowsSpace(live, spaceId);
  const space = await spaceAccess(live.user_id, spaceId);
  if (["trashed", "purging"].includes(space.effective_status))
    throw new HttpError(404, "This research workspace is unavailable.");
  return live;
}

function nativeRequest(
  spaceId: string,
  path: string,
  params: Record<string, unknown> = {},
) {
  const url = new URL(`https://axiom.invalid/api/v1/${path}`);
  for (const [key, value] of Object.entries(params))
    if (value !== undefined)
      url.searchParams.set(
        key,
        Array.isArray(value) ? value.join(",") : String(value),
      );
  url.searchParams.set("spaceId", spaceId);
  return new Request(url);
}
async function nativeResult(response: Response | null) {
  if (!response) throw new HttpError(404, "Research read unavailable.");
  if (!response.ok)
    throw new HttpError(
      response.status,
      "Research read could not be completed.",
    );
  return response.json();
}
function assertSingleWorkspaceRows(
  rows: Record<string, unknown>[],
  spaceId: string,
) {
  return rows.filter((r) => r.space_id === spaceId);
}

export async function executeResearchIntegrationRead(
  connection: IntegrationConnection,
  name: string,
  raw: unknown,
): Promise<Record<string, unknown>> {
  const tool = researchIntegrationTools.find((item) => item.name === name);
  if (!tool) throw new HttpError(404, "Unknown research read.");
  const input = tool.inputSchema.parse(raw);
  const live = await authorizedWorkspace(connection, input.spaceId);
  const result = await withAuditContext(
    {
      actorId: live.user_id,
      integrationId: live.id,
      integrationClient: live.client_id,
      integrationScope: "workspace:read",
      integrationVersion: live.grant_version,
      allowedSpaceIds: [input.spaceId],
      integrationReadArea:
        name === "resource_annotations_read"
          ? "resource-annotations"
          : "research-library",
    },
    async () => {
      if (name === "workspace_references_list") {
        const value = listSchema.parse(input);
        const data = await nativeResult(
          await researchLibraryApi(
            nativeRequest(value.spaceId, "research/library", value.query),
            ["research", "library"],
            live.user_id,
          ),
        );
        const collections = (data.collections as Record<string, unknown>[])
          .slice(0, 200)
          .map(collectionFields);
        return {
          items: data.items.map((item: Record<string, unknown>) => {
            const result = presentIntegrationReference(item);
            delete result.bibtex;
            return result;
          }),
          total: data.total,
          nextCursor: data.nextCursor,
          collections,
          collectionsTruncated: data.collections.length > 200,
          tags: data.tags,
          canEdit: false,
        };
      }
      if (name === "workspace_reference_collections") {
        const value = collectionsSchema.parse(input);
        const data = await nativeResult(
          await researchLibraryApi(
            nativeRequest(
              value.spaceId,
              "research/library/collections",
              value.query,
            ),
            ["research", "library", "collections"],
            live.user_id,
          ),
        );
        const items = data.slice(0, value.query.limit).map(collectionFields);
        return {
          items,
          nextCursor:
            data.length > value.query.limit
              ? String(value.query.cursor + items.length)
              : null,
        };
      }
      if (name === "workspace_reference_read") {
        const value = reference.parse(input);
        const data = await nativeResult(
          await researchLibraryApi(
            nativeRequest(value.spaceId, `research/library/items/${value.id}`),
            ["research", "library", "items", value.id],
            live.user_id,
          ),
        );
        const notes = assertSingleWorkspaceRows(data.notes, value.spaceId);
        const attachments = assertSingleWorkspaceRows(
          data.attachments,
          value.spaceId,
        );
        return {
          ...presentIntegrationReference(data),
          notes: notes.slice(0, 200),
          // Legacy attachment.note_id is upload provenance, not current access.
          // A moved file must not reveal the ID of its original ungranted note.
          attachments: attachments
            .slice(0, 200)
            .map((attachment) =>
              Object.fromEntries(
                ["id", "resource_id", "name", "space_id", "ordinal", "bytes"]
                  .filter((key) => attachment[key] !== undefined)
                  .map((key) => [key, attachment[key]]),
              ),
            ),
          linksTruncated: notes.length > 200 || attachments.length > 200,
        };
      }
      if (name === "workspace_reference_provenance") {
        const value = provenanceSchema.parse(input);
        // The native provenance endpoint does not consume spaceId; pin its target
        // through the native detail check before reading any history.
        await nativeResult(
          await researchLibraryApi(
            nativeRequest(value.spaceId, `research/library/items/${value.id}`),
            ["research", "library", "items", value.id],
            live.user_id,
          ),
        );
        const data = await nativeResult(
          await researchLibraryApi(
            nativeRequest(
              value.spaceId,
              `research/library/items/${value.id}/provenance`,
              value.query,
            ),
            ["research", "library", "items", value.id, "provenance"],
            live.user_id,
          ),
        );
        return {
          items: data.items.map(presentIntegrationProvenance),
          nextCursor: data.nextCursor,
        };
      }
      if (name === "workspace_knowledge_graph") {
        const value = graphSchema.parse(input);
        const data = await nativeResult(
          await researchGraphApi(
            nativeRequest(value.spaceId, "research/graph", value.query),
            ["research", "graph"],
            live.user_id,
          ),
        );
        const ids = new Set((data.nodes as { id: string }[]).map((n) => n.id));
        return {
          ...data,
          edges: data.edges.filter(
            (e: { source: string; target: string }) =>
              ids.has(e.source) && ids.has(e.target),
          ),
        };
      }
      const value = annotationsSchema.parse(input);
      const { resource } = await resourceAccess(live.user_id, value.id);
      if (resource.space_id !== value.spaceId)
        throw new HttpError(
          404,
          "This resource is unavailable in the selected workspace.",
        );
      const [visible] = await query(
        `SELECT id FROM resources r WHERE r.id=$1 AND ${liveResource()}`,
        [value.id],
      );
      if (!visible) throw new HttpError(404, "This resource is unavailable.");
      const paging = {
        spaceId: value.spaceId,
        offset: value.query.cursor,
        limit: value.query.limit,
      };
      let rows: Record<string, unknown>[];
      if (value.query.kind === "pdf") {
        const versionId = value.query.versionId ?? resource.current_version_id;
        if (!versionId) throw new HttpError(400, "Select a PDF file version.");
        rows = (
          await readPaperAnnotations(live.user_id, versionId, {
            ...paging,
            resourceId: resource.id,
          })
        ).map((r) => ({
          id: r.id,
          authorId: r.author_id,
          authorName: r.author_name,
          version: r.version,
          shared: r.shared,
          resolved: r.resolved,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          placement: { resourceId: resource.id, versionId },
          data: r.data,
          replyCount: r.reply_count,
        }));
      } else {
        rows = await readVisualAnnotations(live.user_id, resource.id, paging);
      }
      return {
        kind: value.query.kind,
        items: rows.slice(0, value.query.limit),
        nextCursor:
          rows.length > value.query.limit
            ? String(value.query.cursor + value.query.limit)
            : null,
      };
    },
  );
  // Revalidate after native reads: a revoked grant or moved resource must not
  // escape in an otherwise successful response.
  await authorizedWorkspace(live, input.spaceId);
  if (name === "resource_annotations_read") {
    const value = annotationsSchema.parse(input);
    const { resource } = await resourceAccess(live.user_id, value.id);
    if (resource.space_id !== value.spaceId)
      throw new HttpError(
        409,
        "This resource moved. Read its current workspace before continuing.",
      );
  }
  return result;
}

export const researchIntegrationResourceTemplates = [
  {
    name: "workspace-references",
    uriTemplate: "axiom://workspaces/{spaceId}/references",
    description: "Reference page in one granted workspace.",
  },
  {
    name: "workspace-reference",
    uriTemplate: "axiom://workspaces/{spaceId}/references/{referenceId}",
    description: "A scoped citation record and linked research evidence.",
  },
  {
    name: "workspace-knowledge-graph",
    uriTemplate: "axiom://workspaces/{spaceId}/graph",
    description: "Bounded scoped research graph.",
  },
  {
    name: "resource-annotations",
    uriTemplate:
      "axiom://workspaces/{spaceId}/resources/{resourceId}/annotations",
    description:
      "Visible image/diagram annotations; use the annotation tool for PDF versions and pagination.",
  },
] as const;

export async function readResearchIntegrationResource(
  connection: IntegrationConnection,
  uri: string | URL,
) {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new HttpError(400, "Unsupported research resource URI.");
  }
  if (
    url.protocol !== "axiom:" ||
    url.hostname !== "workspaces" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new HttpError(400, "Unsupported research resource URI.");
  const path = url.pathname.split("/").filter(Boolean);
  const workspaceId = uuid.safeParse(path[0]);
  if (!workspaceId.success)
    throw new HttpError(
      400,
      "Use a valid workspace in the research resource URI.",
    );
  const spaceId = workspaceId.data;
  if (path.length === 2 && path[1] === "references")
    return executeResearchIntegrationRead(
      connection,
      "workspace_references_list",
      { spaceId },
    );
  if (path.length === 3 && path[1] === "references") {
    const referenceId = uuid.safeParse(path[2]);
    if (!referenceId.success)
      throw new HttpError(
        400,
        "Use a valid reference in the research resource URI.",
      );
    return executeResearchIntegrationRead(
      connection,
      "workspace_reference_read",
      { spaceId, id: referenceId.data },
    );
  }
  if (path.length === 2 && path[1] === "graph")
    return executeResearchIntegrationRead(
      connection,
      "workspace_knowledge_graph",
      { spaceId },
    );
  if (
    path.length === 4 &&
    path[1] === "resources" &&
    path[3] === "annotations"
  ) {
    const resourceId = uuid.safeParse(path[2]);
    if (!resourceId.success)
      throw new HttpError(
        400,
        "Use a valid resource in the research resource URI.",
      );
    return executeResearchIntegrationRead(
      connection,
      "resource_annotations_read",
      { spaceId, id: resourceId.data },
    );
  }
  throw new HttpError(404, "Unknown research resource URI.");
}
