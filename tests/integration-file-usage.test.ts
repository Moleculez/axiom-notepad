import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const f = vi.hoisted(() => ({
  query: vi.fn(),
  clientQuery: vi.fn(),
  resource: vi.fn(),
  connection: vi.fn(),
}));
vi.mock("../packages/shared/src/db", () => ({
  query: f.query,
  transaction: async (work: (client: unknown) => unknown) =>
    work({ query: f.clientQuery }),
}));
vi.mock("../packages/shared/src/access", async () => ({
  ...(await vi.importActual("../packages/shared/src/access")),
  resourceAccess: f.resource,
}));
vi.mock("../packages/shared/src/integration-security", async () => ({
  ...(await vi.importActual("../packages/shared/src/integration-security")),
  activeConnection: f.connection,
}));
vi.mock("../packages/shared/src/documents", () => ({
  notifyWorkspace: vi.fn(),
}));
import { resourceOperationsApi } from "../packages/shared/src/resource-operations";
import { withAuditContext } from "../packages/shared/src/audit-context";
const spaceId = randomUUID(),
  fileId = randomUUID(),
  versionId = randomUUID(),
  sourceId = randomUUID();
const context = {
  actorId: "owner",
  integrationId: randomUUID(),
  integrationClient: "study-client",
  integrationScope: "workspace:read",
  integrationVersion: "g1",
};
const request = () =>
  new Request(`https://axiom.test/api/v1/files/${fileId}/usage`);
beforeEach(() => {
  vi.resetAllMocks();
  f.resource.mockResolvedValue({
    resource: { id: fileId, kind: "file", space_id: spaceId },
  });
  f.query.mockResolvedValue([{ id: versionId }]);
  f.connection.mockResolvedValue({
    client_id: context.integrationClient,
    space_ids: [spaceId],
  });
});
describe("MCP file usage does not reveal account-wide retention metadata", () => {
  it("returns only selected-workspace sources/counts and preserves native-only deletion eligibility", async () => {
    f.clientQuery.mockResolvedValue({
      rows: [
        { id: sourceId, name: "Lesson", snapshot: false, visible_count: 1 },
      ],
    });
    const result = await withAuditContext(context, () =>
      resourceOperationsApi(request(), ["files", fileId, "usage"], "owner"),
    );
    expect(await result!.json()).toMatchObject({
      references: 1,
      countsScope: "selected_workspace",
      deletionEligibility: "requires_in_app_review",
      sources: [{ id: sourceId, name: "Lesson", snapshot: false }],
    });
    expect(f.clientQuery).toHaveBeenCalledTimes(1);
    const [sql, values] = f.clientQuery.mock.calls[0];
    expect(sql).toContain("r.space_id=$3");
    expect(values).toEqual(["owner", [versionId], spaceId]);
    expect(sql).not.toContain("reading_items");
    expect(sql).not.toContain("paper_annotations");
  });
  it("rejects stale grants and unshared file workspaces before reading reference metadata", async () => {
    f.connection.mockResolvedValue({
      client_id: context.integrationClient,
      space_ids: [],
    });
    await expect(
      withAuditContext(context, () =>
        resourceOperationsApi(request(), ["files", fileId, "usage"], "owner"),
      ),
    ).rejects.toThrow(/not shared/);
    expect(f.clientQuery).not.toHaveBeenCalled();
    f.connection.mockRejectedValue(new Error("Grant revoked"));
    await expect(
      withAuditContext(context, () =>
        resourceOperationsApi(request(), ["files", fileId, "usage"], "owner"),
      ),
    ).rejects.toThrow(/revoked/);
  });
  it("leaves native retention counts and deletion safeguards unchanged", async () => {
    f.clientQuery
      .mockResolvedValueOnce({
        rows: [
          {
            references: 8,
            annotations: 3,
            reading: 5,
            citations: 2,
            drafts: 0,
            reviews: 1,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    const result = await resourceOperationsApi(
      request(),
      ["files", fileId, "usage"],
      "owner",
    );
    expect(await result!.json()).toMatchObject({
      references: 8,
      annotations: 3,
      reading: 5,
      citations: 2,
    });
    expect(f.connection).not.toHaveBeenCalled();
    expect(f.clientQuery.mock.calls[0][0]).toContain("reading_items");
  });
});
