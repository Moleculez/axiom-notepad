import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const f = vi.hoisted(() => ({
  query: vi.fn(),
  transaction: vi.fn(),
  scope: vi.fn(),
  connection: vi.fn(),
  allow: vi.fn(),
  clientQuery: vi.fn(),
}));
vi.mock("../packages/shared/src/db", () => ({
  query: f.query,
  transaction: f.transaction,
}));
vi.mock("../packages/shared/src/workspace-service", () => ({
  requireScope: f.scope,
  workspaceMutation: vi.fn(),
}));
vi.mock("../packages/shared/src/integration-security", () => ({
  activeConnection: f.connection,
  connectionAllowsSpace: f.allow,
}));

import { withAuditContext } from "../packages/shared/src/audit-context";
import {
  requireLibraryScope,
  referenceAccess,
  referenceLinks,
  libraryWrite,
  libraryLinkedSpacePredicate,
  libraryPredicate,
  resolveLibraryScope,
} from "../packages/shared/src/research-library-service";
import type { AuditContext } from "../packages/shared/src/audit-context";
const spaceId = randomUUID(),
  otherSpace = randomUUID(),
  id = randomUUID();
const context: AuditContext = {
  actorId: "owner",
  integrationId: randomUUID(),
  integrationClient: "course",
  integrationScope: "workspace:read",
  integrationVersion: "g1",
  allowedSpaceIds: [spaceId],
  integrationReadArea: "research-library",
};
const client = { query: f.clientQuery } as never;

beforeEach(() => {
  vi.resetAllMocks();
  f.clientQuery.mockResolvedValue({
    rows: [{ id: spaceId, role: "editor", state: "active" }],
  });
  f.connection.mockResolvedValue({ client_id: "course", space_ids: [spaceId] });
  f.scope.mockResolvedValue({ role: "editor" });
  f.transaction.mockImplementation((work) => work(client));
  f.query.mockResolvedValue([]);
});

describe("explicit read-only reference library authority", () => {
  it("allows only pinned research reads and revalidates live grant revision", async () => {
    await withAuditContext(context, () =>
      requireLibraryScope(client, "owner", { spaceId }),
    );
    expect(f.connection).toHaveBeenCalledWith(
      context.integrationId,
      "owner",
      "workspace:read",
      client,
      "g1",
    );
    expect(f.allow).toHaveBeenCalledWith(
      { client_id: "course", space_ids: [spaceId] },
      spaceId,
    );
    expect(f.scope).toHaveBeenCalledWith(client, "owner", spaceId, "read");
  });
  it("continues forbidding write/import/merge even inside an authorized read adapter", async () => {
    await expect(
      withAuditContext(context, () =>
        requireLibraryScope(client, "owner", { spaceId }, true),
      ),
    ).rejects.toMatchObject({ status: 403 });
    for (const action of [
      "create",
      "import",
      "merge",
      "copy",
      "edit:reference",
    ])
      await expect(
        withAuditContext(context, () =>
          libraryWrite("owner", { spaceId }, id, action, {}, async () => ({
            done: true,
          })),
        ),
      ).rejects.toMatchObject({ status: 403 });
    expect(f.connection).not.toHaveBeenCalled();
    expect(f.scope).not.toHaveBeenCalled();
  });
  it("rejects generic integrations, assistant/reviewed scope, other spaces, or identities", async () => {
    for (const candidate of [
      { ...context, integrationReadArea: undefined },
      { allowedSpaceIds: [spaceId] },
      { ...context, allowedSpaceIds: [spaceId, otherSpace] },
      { ...context, actorId: "other" },
      { ...context, integrationScope: "workspace:write" },
      { ...context, integrationVersion: undefined },
    ])
      await expect(
        withAuditContext(candidate, () =>
          requireLibraryScope(client, "owner", { spaceId }),
        ),
      ).rejects.toMatchObject({ status: 403 });
    await expect(
      withAuditContext(context, () =>
        requireLibraryScope(client, "owner", { spaceId: otherSpace }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      withAuditContext(context, () =>
        resolveLibraryScope("owner", { groupId: id }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("denies disabled/revoked connections before native library reads", async () => {
    f.connection.mockRejectedValue(new Error("Permission revoked"));
    await expect(
      withAuditContext(context, () =>
        requireLibraryScope(client, "owner", { spaceId }),
      ),
    ).rejects.toThrow(/revoked/);
    expect(f.clientQuery).not.toHaveBeenCalled();
  });
  it("preserves private-owner and workspace visibility", async () => {
    f.query.mockResolvedValue([
      { id, owner_user_id: "private-owner", space_id: spaceId },
    ]);
    await expect(
      withAuditContext(context, () => referenceAccess("owner", id)),
    ).rejects.toMatchObject({ status: 404 });
    expect(f.connection).not.toHaveBeenCalled();
    expect(libraryPredicate()).toContain("owner_user_id=$1");
    f.clientQuery.mockResolvedValue({
      rows: [{ id: spaceId, role: null, state: "active" }],
    });
    await expect(
      withAuditContext(context, () =>
        requireLibraryScope(client, "owner", { spaceId }),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("filters both linked note/PDF queries and counts to selected workspace", async () => {
    await withAuditContext(context, async () => {
      expect(libraryLinkedSpacePredicate()).toBe(" AND r.space_id=$2::uuid");
      await referenceLinks("owner", id);
    });
    expect(f.query).toHaveBeenCalledTimes(2);
    for (const [sql, values] of f.query.mock.calls) {
      expect(sql).toContain("r.space_id=$3");
      expect(sql).toContain("LIMIT 201");
      expect(values).toEqual([id, "owner", spaceId]);
    }
    expect(libraryLinkedSpacePredicate()).toBe("");
  });
});
