import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const f = vi.hoisted(() => ({
  connection: vi.fn(),
  allow: vi.fn(),
  space: vi.fn(),
  resource: vi.fn(),
  query: vi.fn(),
  library: vi.fn(),
  graph: vi.fn(),
  visual: vi.fn(),
  paper: vi.fn(),
}));
vi.mock("../packages/shared/src/db", () => ({
  query: f.query,
  transaction: vi.fn(),
}));
vi.mock("../packages/shared/src/access", async () => ({
  ...(await vi.importActual("../packages/shared/src/access")),
  spaceAccess: f.space,
  resourceAccess: f.resource,
}));
vi.mock("../packages/shared/src/integration-security", () => ({
  activeConnection: f.connection,
  connectionAllowsSpace: f.allow,
}));
vi.mock("../packages/shared/src/research-library-api", () => ({
  researchLibraryApi: f.library,
}));
vi.mock("../packages/shared/src/research-graph-api", () => ({
  researchGraphApi: f.graph,
}));
vi.mock("../packages/shared/src/visual-annotations-api", () => ({
  readVisualAnnotations: f.visual,
}));
vi.mock("../packages/shared/src/research-api", () => ({
  readPaperAnnotations: f.paper,
}));

import { currentAuditContext } from "../packages/shared/src/audit-context";
import {
  executeResearchIntegrationRead,
  researchIntegrationTools,
  readResearchIntegrationResource,
  presentIntegrationProvenance,
  presentIntegrationReference,
} from "../packages/shared/src/integration-research";
import type { IntegrationConnection } from "../packages/shared/src/integration-security";

const spaceId = randomUUID(),
  otherSpace = randomUUID(),
  id = randomUUID();
const connection = {
  id: randomUUID(),
  user_id: "fixture",
  client_id: "local-course",
  grant_version: "g1",
  space_ids: [spaceId],
  scopes: ["workspace:read"],
} as IntegrationConnection;

beforeEach(() => {
  vi.resetAllMocks();
  f.connection.mockResolvedValue(connection);
  f.space.mockResolvedValue({ id: spaceId, effective_status: "active" });
  f.resource.mockResolvedValue({
    resource: { id, space_id: spaceId },
    space: { id: spaceId, effective_status: "active" },
  });
  f.query.mockResolvedValue([{ id }]);
  f.visual.mockResolvedValue([]);
  f.paper.mockResolvedValue([]);
});

describe("scoped research MCP reads", () => {
  it("provides strict read-only schemas and rejects scope overrides before native reads", async () => {
    expect(researchIntegrationTools).toHaveLength(6);
    for (const tool of researchIntegrationTools) {
      expect(tool.annotations.readOnlyHint).toBe(true);
      const target =
        tool.name.includes("reference_read") ||
        tool.name.includes("provenance") ||
        tool.name === "resource_annotations_read"
          ? { id }
          : {};
      expect(tool.inputSchema.safeParse({ spaceId, ...target }).success).toBe(
        true,
      );
      expect(
        tool.inputSchema.safeParse({
          spaceId,
          ...target,
          query: { groupId: otherSpace },
        }).success,
      ).toBe(false);
    }
    await expect(
      executeResearchIntegrationRead(connection, "workspace_references_list", {
        spaceId,
        query: { spaceId: otherSpace },
      }),
    ).rejects.toThrow();
    await expect(
      executeResearchIntegrationRead(connection, "workspace_references_list", {
        spaceId,
        query: { limit: 101 },
      }),
    ).rejects.toThrow();
    expect(f.library).not.toHaveBeenCalled();
  });
  it("preserves audit attribution and hides private import/provider payloads", async () => {
    f.library.mockImplementation(async (req: Request) => {
      expect(new URL(req.url).searchParams.get("spaceId")).toBe(spaceId);
      expect(currentAuditContext()).toMatchObject({
        actorId: connection.user_id,
        integrationId: connection.id,
        integrationVersion: "g1",
        integrationReadArea: "research-library",
        allowedSpaceIds: [spaceId],
      });
      return Response.json({
        items: [
          {
            id,
            space_id: spaceId,
            title: "Lesson",
            import_source: { secret: "provider" },
            bibtex: "@article{lesson}",
          },
        ],
        total: 1,
        nextCursor: null,
        collections: [],
        tags: [],
      });
    });
    const result = await executeResearchIntegrationRead(
      connection,
      "workspace_references_list",
      { spaceId },
    );
    expect(result.items).toEqual([{ id, space_id: spaceId, title: "Lesson" }]);
    expect(result.canEdit).toBe(false);
    expect(f.connection).toHaveBeenCalledTimes(2);
    expect(currentAuditContext()).toBeUndefined();
  });
  it("does not expose linked titles or PDFs outside the selected workspace", async () => {
    f.library.mockResolvedValue(
      Response.json({
        id,
        space_id: spaceId,
        title: "Reference",
        owner_user_id: "fixture",
        notes: [
          { id, space_id: spaceId, title: "Local" },
          { id: randomUUID(), space_id: otherSpace, title: "Do not disclose" },
        ],
        attachments: [{ space_id: otherSpace, name: "Private.pdf" }],
      }),
    );
    const result = await executeResearchIntegrationRead(
      connection,
      "workspace_reference_read",
      { spaceId, id },
    );
    expect(result.notes).toEqual([{ id, space_id: spaceId, title: "Local" }]);
    expect(result.attachments).toEqual([]);
    expect(result.owner_user_id).toBeUndefined();
  });
  it("rejects revoked grants and inaccessible workspaces before returning content", async () => {
    f.library.mockResolvedValue(
      Response.json({
        items: [],
        total: 0,
        nextCursor: null,
        collections: [],
        tags: [],
      }),
    );
    f.connection
      .mockResolvedValueOnce(connection)
      .mockRejectedValueOnce(new Error("Revoked grant"));
    await expect(
      executeResearchIntegrationRead(connection, "workspace_references_list", {
        spaceId,
      }),
    ).rejects.toThrow(/Revoked/);
    f.connection.mockResolvedValue(connection);
    f.allow.mockImplementation(() => {
      throw new Error("Workspace not granted");
    });
    await expect(
      executeResearchIntegrationRead(connection, "workspace_knowledge_graph", {
        spaceId: otherSpace,
      }),
    ).rejects.toThrow(/not granted/);
    expect(f.graph).not.toHaveBeenCalled();
  });
  it("does not expose a moved attachment's original ungranted note ID", async () => {
    f.library.mockResolvedValue(
      Response.json({
        id,
        space_id: spaceId,
        title: "Reference",
        notes: [],
        attachments: [
          {
            id,
            resource_id: id,
            space_id: spaceId,
            name: "Course.pdf",
            ordinal: 1,
            bytes: 20,
            note_id: otherSpace,
            import_source: "private",
          },
        ],
      }),
    );
    const result = await executeResearchIntegrationRead(
      connection,
      "workspace_reference_read",
      { spaceId, id },
    );
    expect(result.attachments).toEqual([
      {
        id,
        resource_id: id,
        space_id: spaceId,
        name: "Course.pdf",
        ordinal: 1,
        bytes: 20,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(otherSpace);
  });
  it("returns only graph edges connecting returned nodes", async () => {
    f.graph.mockResolvedValue(
      Response.json({
        nodes: [{ id: "note:one" }, { id: "reference:two" }],
        edges: [
          { source: "note:one", target: "reference:two" },
          { source: "note:one", target: "pdf:ungranted" },
        ],
        truncated: false,
      }),
    );
    const result = await executeResearchIntegrationRead(
      connection,
      "workspace_knowledge_graph",
      { spaceId },
    );
    expect(result.edges).toEqual([
      { source: "note:one", target: "reference:two" },
    ]);
  });
  it("pins PDF versions to the authorized resource and paginates without silently discarding rows", async () => {
    const versionId = randomUUID();
    f.paper.mockResolvedValue([
      { id: "first", author_id: "fixture", data: { body: "Read" } },
      { id: "next" },
    ]);
    const result = await executeResearchIntegrationRead(
      connection,
      "resource_annotations_read",
      { spaceId, id, query: { kind: "pdf", versionId, limit: 1, cursor: 20 } },
    );
    expect(f.paper).toHaveBeenCalledWith("fixture", versionId, {
      resourceId: id,
      spaceId,
      offset: 20,
      limit: 1,
    });
    expect(result.nextCursor).toBe("21");
    expect(result.items).toHaveLength(1);
    f.resource.mockResolvedValue({ resource: { id, space_id: otherSpace } });
    await expect(
      executeResearchIntegrationRead(connection, "resource_annotations_read", {
        spaceId,
        id,
      }),
    ).rejects.toThrow(/selected workspace/);
    expect(f.visual).not.toHaveBeenCalled();
  });
  it("supports strict resource URIs and safely rejects malformed or broadened resources", async () => {
    f.graph.mockResolvedValue(Response.json({ nodes: [], edges: [] }));
    await readResearchIntegrationResource(
      connection,
      new URL(`axiom://workspaces/${spaceId}/graph`),
    );
    for (const uri of [
      "invalid",
      "axiom://workspaces/not-a-uuid/graph",
      `axiom://workspaces/${spaceId}/graph?spaceId=${otherSpace}`,
      `axiom://attacker/${spaceId}/graph`,
    ])
      await expect(
        readResearchIntegrationResource(connection, uri),
      ).rejects.toMatchObject({ status: 400 });
  });
  it("uses a field whitelist for provenance and explicitly identifies bounded fields", () => {
    expect(
      presentIntegrationProvenance({
        id,
        details: { apiKey: "private" },
        before_data: { title: "Before", import_source: { raw: "private" } },
        after_data: { title: "After", provider_payload: "private" },
        kind: "lookup",
      }),
    ).toEqual({
      id,
      kind: "lookup",
      before_data: { title: "Before" },
      after_data: { title: "After" },
    });
    expect(
      presentIntegrationReference({
        title: "a".repeat(100_001),
        import_source: {},
      }),
    ).toMatchObject({ truncatedFields: ["title"] });
  });
});
