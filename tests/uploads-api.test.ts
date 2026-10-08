import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const f = vi.hoisted(() => ({
  query: vi.fn(),
  clientQuery: vi.fn(),
  scope: vi.fn(),
  enqueue: vi.fn(),
  lock: vi.fn(),
}));
vi.mock("../packages/shared/src/db", () => ({
  query: f.query,
  transaction: async (work: (client: unknown) => unknown) =>
    work({ query: f.clientQuery }),
}));
vi.mock("../packages/shared/src/access", async () => ({
  ...(await vi.importActual("../packages/shared/src/access")),
  spaceAccess: f.scope,
}));
vi.mock("../packages/shared/src/workspace-service", () => ({
  workspaceJson: (value: unknown, status = 200) =>
    Response.json(value, { status }),
  requireScope: f.scope,
  enqueueJob: vi.fn(),
  recordActivity: vi.fn(),
}));
vi.mock("../packages/shared/src/upload-verification", () => ({
  enqueueUploadVerification: f.enqueue,
}));
vi.mock("../packages/shared/src/workspace-import-access", () => ({
  lockImportUpload: f.lock,
}));
vi.mock("../packages/shared/src/documents", () => ({
  notifyWorkspace: vi.fn(),
}));
import { uploadsApi } from "../packages/shared/src/uploads-api";
const id = randomUUID(),
  spaceId = randomUUID(),
  resourceId = randomUUID(),
  versionId = randomUUID();
let upload: Record<string, any>;
const complete = () =>
  uploadsApi(
    new Request(`https://axiom.test/api/v1/uploads/${id}/complete`, {
      method: "POST",
      body: "{}",
    }),
    ["uploads", id, "complete"],
    "owner",
  );
beforeEach(() => {
  vi.resetAllMocks();
  upload = {
    id,
    owner_id: "owner",
    space_id: spaceId,
    bytes: 4,
    status: "verifying",
    expires_at: new Date(Date.now() + 60_000),
    import_entry_id: null,
  };
  f.query.mockImplementation(async () => [upload]);
  f.clientQuery.mockImplementation(async (sql: string) => ({
    rows: sql.startsWith("SELECT * FROM upload_sessions")
      ? [upload]
      : sql.startsWith("SELECT count(*)")
        ? [{ count: 1, bytes: 4 }]
        : [],
  }));
});
describe("upload completion rechecks", () => {
  it("re-enqueues a verifying transfer instead of returning an unrecoverable no-op", async () => {
    const response = await complete();
    expect(await response!.json()).toMatchObject({ status: "verifying" });
    expect(f.enqueue).toHaveBeenCalledWith(expect.anything(), id);
    expect(
      f.clientQuery.mock.calls.some(([sql]) =>
        sql.startsWith("UPDATE upload_sessions"),
      ),
    ).toBe(false);
  });
  it("returns the current terminal state and both immutable IDs after a race", async () => {
    f.query.mockResolvedValue([{ ...upload }]);
    Object.assign(upload, {
      status: "complete",
      completed_resource_id: resourceId,
      completed_version_id: versionId,
    });
    const response = await complete();
    expect(await response!.json()).toMatchObject({
      status: "complete",
      resourceId,
      versionId,
    });
    expect(f.enqueue).not.toHaveBeenCalled();
  });
  it("still rejects missing parts, expired uploads, cancellation and revoked authority", async () => {
    f.clientQuery.mockImplementation(async (sql: string) => ({
      rows: sql.startsWith("SELECT *") ? [upload] : [{ count: 0, bytes: 0 }],
    }));
    await expect(complete()).rejects.toThrow("Some file parts are missing");
    upload.expires_at = new Date(0);
    await expect(complete()).rejects.toThrow("expired or was cancelled");
    upload.status = "cancelled";
    await expect(complete()).rejects.toThrow("expired or was cancelled");
    f.scope.mockRejectedValue(new Error("Access revoked"));
    await expect(complete()).rejects.toThrow("Access revoked");
    expect(f.enqueue).not.toHaveBeenCalled();
  });
  it("does not let an ordinary endpoint manage private import transfers", async () => {
    upload.import_entry_id = randomUUID();
    await expect(complete()).rejects.toThrow("owning import");
    expect(f.enqueue).not.toHaveBeenCalled();
  });
  it("bounds requested status IDs while retaining owner, edit and import filters", async () => {
    await uploadsApi(
      new Request(`https://axiom.test/api/v1/uploads?ids=${id}`),
      ["uploads"],
      "owner",
    );
    const [sql, args] = f.query.mock.calls[0];
    expect(args).toEqual(["owner", [id]]);
    expect(sql).toContain("u.owner_id=$1");
    expect(sql).toContain("u.import_entry_id IS NULL");
    expect(sql).toContain("axiom_space_role($1,u.space_id)='editor'");
    expect(sql).toContain("verification_state");
    await expect(
      uploadsApi(
        new Request("https://axiom.test/api/v1/uploads?ids=invalid"),
        ["uploads"],
        "owner",
      ),
    ).rejects.toThrow();
    await expect(
      uploadsApi(
        new Request(
          `https://axiom.test/api/v1/uploads?ids=${Array(101).fill(id).join(",")}`,
        ),
        ["uploads"],
        "owner",
      ),
    ).rejects.toThrow();
    expect(f.query).toHaveBeenCalledTimes(1);
  });
});
