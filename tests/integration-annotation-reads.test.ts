import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const f = vi.hoisted(() => ({
  query: vi.fn(),
  resource: vi.fn(),
  file: vi.fn(),
  connection: vi.fn(),
  allow: vi.fn(),
}));
vi.mock("../packages/shared/src/db", () => ({
  query: f.query,
  transaction: vi.fn(),
}));
vi.mock("../packages/shared/src/access", async () => ({
  ...(await vi.importActual("../packages/shared/src/access")),
  resourceAccess: f.resource,
  fileAccess: f.file,
}));
vi.mock("../packages/shared/src/integration-security", () => ({
  activeConnection: f.connection,
  connectionAllowsSpace: f.allow,
}));
vi.mock("../packages/shared/src/documents", () => ({
  notifyWorkspace: vi.fn(),
}));
import { withAuditContext } from "../packages/shared/src/audit-context";
import { readVisualAnnotations } from "../packages/shared/src/visual-annotations-api";
import { readPaperAnnotations } from "../packages/shared/src/research-api";

const spaceId = randomUUID(),
  resourceId = randomUUID(),
  versionId = randomUUID(),
  otherSpace = randomUUID();
const context = {
  actorId: "owner",
  integrationId: randomUUID(),
  integrationClient: "course",
  integrationVersion: "g1",
  integrationScope: "workspace:read",
  integrationReadArea: "resource-annotations" as const,
  allowedSpaceIds: [spaceId],
};
const page = { spaceId, offset: 100, limit: 50 };
beforeEach(() => {
  vi.resetAllMocks();
  f.resource.mockResolvedValue({
    resource: { id: resourceId, space_id: spaceId },
    space: { id: spaceId, effective_status: "active" },
  });
  f.file.mockResolvedValue({
    file: { id: versionId, resource_id: resourceId, mime: "application/pdf" },
    space: { id: spaceId, effective_status: "active" },
  });
  f.query.mockResolvedValue([]);
  f.connection.mockResolvedValue({ client_id: "course", space_ids: [spaceId] });
});
describe("native annotation MCP adapter visibility", () => {
  it("keeps private roots private and excludes placements outside the selected workspace", async () => {
    await withAuditContext(context, () =>
      readVisualAnnotations("owner", resourceId, page),
    );
    const [sql, values] = f.query.mock.calls[0];
    expect(sql).toContain("root.visibility='shared' OR root.author_id=$2");
    expect(sql).toContain("ref.space_id=$3");
    expect(sql).toContain("a.data->'placement'->>'resourceId'");
    expect(sql).toContain("AND NOT a.deleted");
    expect(values).toEqual([resourceId, "owner", spaceId, 51, 100]);
    expect(f.connection).toHaveBeenCalledWith(
      context.integrationId,
      "owner",
      "workspace:read",
      undefined,
      "g1",
    );
  });
  it("pins paper versions to the selected resource and uses native private/shared visibility", async () => {
    await withAuditContext(context, () =>
      readPaperAnnotations("owner", versionId, { ...page, resourceId }),
    );
    const [sql, values] = f.query.mock.calls[0];
    expect(sql).toContain("a.author_id=$2 OR a.shared");
    expect(sql).toContain("AND NOT a.deleted");
    expect(values).toEqual([versionId, "owner", 51, 100]);
    f.file.mockResolvedValue({
      file: { resource_id: randomUUID(), mime: "application/pdf" },
      space: { id: spaceId },
    });
    await expect(
      withAuditContext(context, () =>
        readPaperAnnotations("owner", versionId, { ...page, resourceId }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(f.query).toHaveBeenCalledTimes(1);
  });
  it("rechecks disabled/revoked grants and denies non-adapter access", async () => {
    f.connection.mockRejectedValueOnce(new Error("Revoked"));
    await expect(
      withAuditContext(context, () =>
        readVisualAnnotations("owner", resourceId, page),
      ),
    ).rejects.toThrow(/Revoked/);
    await expect(
      withAuditContext({ ...context, integrationReadArea: undefined }, () =>
        readVisualAnnotations("owner", resourceId, page),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      withAuditContext(context, () => readPaperAnnotations("owner", versionId)),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.query).not.toHaveBeenCalled();
  });
  it("rejects moved resources and other users or spaces", async () => {
    f.resource.mockResolvedValue({
      resource: { space_id: otherSpace },
      space: { effective_status: "active" },
    });
    await expect(
      withAuditContext(context, () =>
        readVisualAnnotations("owner", resourceId, page),
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      withAuditContext({ ...context, actorId: "other" }, () =>
        readPaperAnnotations("owner", versionId, { ...page, resourceId }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.query).not.toHaveBeenCalled();
  });
});
