import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  client: vi.fn(),
  resource: vi.fn(),
  file: vi.fn(),
  scope: vi.fn(),
}));
vi.mock("../packages/shared/src/db", () => ({
  query: mocks.query,
  transaction: (fn: (client: unknown) => unknown) =>
    fn({ query: mocks.client }),
}));
vi.mock("../packages/shared/src/access", () => ({
  resourceAccess: mocks.resource,
  fileAccess: mocks.file,
  memberAccess: vi.fn(),
  HttpError: class extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("../packages/shared/src/workspace-service", () => ({
  workspaceJson: (value: unknown, status = 200) =>
    Response.json(value, { status }),
  requireScope: mocks.scope,
  assertGroupActive: vi.fn(),
  recordActivity: vi.fn(),
}));
vi.mock("../packages/shared/src/tool-providers", () => ({
  providerEndpoint: vi.fn(),
  sealCredential: vi.fn(),
  providerKey: vi.fn(),
  callMathProvider: vi.fn(),
}));
import { toolServicesApi } from "../packages/shared/src/tool-services-api";
const user = "11111111-1111-4111-8111-111111111111",
  resource = "22222222-2222-4222-8222-222222222222",
  version = "33333333-3333-4333-8333-333333333333",
  provider = "44444444-4444-4444-8444-444444444444",
  job = "55555555-5555-4555-8555-555555555555";
const body = {
  resourceId: resource,
  versionId: version,
  providerId: provider,
  context: "paper",
  kind: "explain",
  source: "[p. 1]\nEvidence",
  prompt: "Explain",
  consent: true,
};
const request = (value = body) =>
  new Request("http://localhost/api/v1/tool-jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
let capabilities: string[];
beforeEach(() => {
  vi.clearAllMocks();
  capabilities = ["paper", "ocr"];
  mocks.resource.mockResolvedValue({
    resource: { id: resource, space_id: "space" },
    space: { group_id: "group" },
  });
  mocks.file.mockResolvedValue({
    file: { resource_id: resource, mime: "application/pdf" },
  });
  mocks.client.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT p.*"))
      return { rows: [{ capabilities, daily_limit: 25 }] };
    if (sql.includes("count(*)")) return { rows: [{ count: 0 }] };
    if (sql.startsWith("INSERT"))
      return { rows: [{ id: job, status: "queued" }] };
    return { rows: [] };
  });
});
describe("private version-bound paper jobs", () => {
  it("allows an authorized reader to enqueue only the selected immutable PDF version", async () => {
    const response = await toolServicesApi(request(), ["tool-jobs"], user);
    expect(response?.status).toBe(202);
    expect(mocks.resource).toHaveBeenCalledWith(user, resource, "read");
    expect(mocks.file).toHaveBeenCalledWith(user, version);
    expect(mocks.scope).toHaveBeenCalledWith(
      expect.anything(),
      user,
      "space",
      "read",
    );
    const insert = mocks.client.mock.calls.find(([sql]) =>
      sql.startsWith("INSERT"),
    )!;
    expect(insert[1][5]).toBe(version);
    expect(JSON.parse(insert[1][4])).toMatchObject({
      context: "paper",
      source: body.source,
    });
  });
  it("rejects another file's version before anything is queued", async () => {
    mocks.file.mockResolvedValue({
      file: { resource_id: "other", mime: "application/pdf" },
    });
    await expect(
      toolServicesApi(request(), ["tool-jobs"], user),
    ).rejects.toMatchObject({ status: 400 });
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("requires explicit consent and a paper-capable provider, including OCR", async () => {
    await expect(
      toolServicesApi(
        request({ ...body, consent: false }),
        ["tool-jobs"],
        user,
      ),
    ).rejects.toThrow();
    capabilities = ["math", "ocr"];
    await expect(
      toolServicesApi(request(), ["tool-jobs"], user),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      toolServicesApi(
        request({
          ...body,
          kind: "ocr",
          image: "data:image/png;base64,YQ==",
        } as typeof body),
        ["tool-jobs"],
        user,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      mocks.client.mock.calls.some(([sql]) => sql.startsWith("INSERT")),
    ).toBe(false);
  });
  it("deletes sensitive history but retains the quota receipt and stops pending jobs", async () => {
    mocks.query.mockResolvedValue([
      {
        id: job,
        owner_id: user,
        resource_id: resource,
        version_id: version,
        status: "running",
        result: null,
      },
    ]);
    const result = await toolServicesApi(
      new Request(`http://localhost/api/v1/tool-jobs/${job}`, {
        method: "DELETE",
      }),
      ["tool-jobs", job],
      user,
    );
    expect(result?.status).toBe(200);
    expect(mocks.query.mock.calls[0][1]).toEqual([job, user]);
    const [sql, args] = mocks.query.mock.calls[1];
    expect(sql).toContain("input='{}'");
    expect(sql).toContain("cancelled");
    expect(sql).toContain("deleted");
    expect(sql).toContain("owner_id=$2");
    expect(sql).not.toContain("DELETE FROM");
    expect(args).toEqual([job, user]);
  });
  it("does not expose or cancel a different account's request", async () => {
    mocks.query.mockResolvedValue([]);
    await expect(
      toolServicesApi(
        new Request(`http://localhost/api/v1/tool-jobs/${job}`),
        ["tool-jobs", job],
        user,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.query.mock.calls[0][0]).toContain("owner_id=$2");
    expect(mocks.query.mock.calls[0][1]).toEqual([job, user]);
  });
});
