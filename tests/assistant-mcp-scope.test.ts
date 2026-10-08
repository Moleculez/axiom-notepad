import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const f = vi.hoisted(() => ({
  query: vi.fn(),
  handle: vi.fn(),
  connection: vi.fn(),
  allow: vi.fn(),
  space: vi.fn(),
}));
vi.mock("@axiom/shared/db", () => ({ query: f.query, transaction: vi.fn() }));
vi.mock("@axiom/shared/access", async () => ({
  ...(await vi.importActual("@axiom/shared/access")),
  spaceAccess: f.space,
}));
vi.mock("@axiom/shared/integration-security", () => ({
  activeConnection: f.connection,
  connectionAllowsSpace: f.allow,
}));
vi.mock("@axiom/shared/auth", () => ({
  appUrl: "https://isolated.axiom.test",
}));
vi.mock("@axiom/shared/documents", () => ({ flushNote: vi.fn() }));
vi.mock("@axiom/shared/integration-change-sets", () => ({
  prepareIntegrationChange: vi.fn(),
}));
vi.mock("../apps/web/lib/api-handler", () => ({ handleAuthorized: f.handle }));
import {
  boundedIntegrationResponse,
  executeIntegrationAction,
} from "../apps/web/lib/integration-executor";
import { integrationActions } from "../packages/shared/src/integration-catalog";
const space = randomUUID(),
  other = randomUUID(),
  id = randomUUID();
const connection = {
  id: randomUUID(),
  user_id: "owner",
  space_ids: [space],
  grant_version: "g1",
};
beforeEach(() => {
  vi.resetAllMocks();
  f.query.mockResolvedValue([
    { id: "owner", email: "synthetic@axiom.test", name: "Fixture" },
  ]);
  f.space.mockResolvedValue({ id: space });
  f.connection.mockResolvedValue(connection);
  f.handle.mockResolvedValue(new Response(JSON.stringify({ items: [] })));
});
describe("integration response byte bounds", () => {
  it("preserves multibyte text split across streaming chunks at the exact limit", async () => {
    const bytes = new TextEncoder().encode("α🙂"),
      stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice(0, 3));
          controller.enqueue(bytes.slice(3));
          controller.close();
        },
      });
    expect(
      await boundedIntegrationResponse(new Response(stream), bytes.byteLength),
    ).toBe("α🙂");
  });
  it("counts UTF-8 bytes rather than characters and cancels oversized streams", async () => {
    const cancel = vi.fn(),
      stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("🙂"));
        },
        cancel,
      });
    await expect(
      boundedIntegrationResponse(new Response(stream), 3),
    ).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });
  it("rejects oversized action responses before native output reaches the client", async () => {
    f.handle.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: ["🙂".repeat(1_000_001)] })),
    );
    await expect(
      executeIntegrationAction(connection as never, "files_list", {
        spaceId: space,
      }),
    ).rejects.toThrow(/response limit/);
  });
});
describe("MCP evidence tools reuse native reads without broadening OAuth scope", () => {
  it("forces search to the granted workspace even when the user could read another group workspace", async () => {
    await executeIntegrationAction(
      connection as never,
      "workspace_evidence_search",
      {
        spaceId: space,
        query: { q: "study", spaceIds: other, space: other, spaces: other },
      },
    );
    const req = f.handle.mock.calls[0][0] as Request,
      params = new URL(req.url).searchParams;
    expect(req.method).toBe("GET");
    for (const key of ["spaceIds", "spaceId", "space", "spaces"])
      expect(params.get(key)).toBe(space);
    expect(f.allow).toHaveBeenCalledWith(connection, space);
    expect(f.connection).toHaveBeenCalledTimes(3);
  });
  it("keeps evidence reads permission filtered and cannot approve context or invoke writes", async () => {
    await executeIntegrationAction(
      connection as never,
      "workspace_evidence_read",
      {
        spaceId: space,
        query: { id, from: "0", to: "10", hash: "a".repeat(64) },
      },
    );
    const req = f.handle.mock.calls[0][0] as Request;
    expect(req.method).toBe("GET");
    expect(new URL(req.url).pathname).toBe(
      `/api/v1/spaces/${space}/assistant/evidence`,
    );
    for (const name of [
      "workspace_evidence_search",
      "workspace_evidence_read",
    ]) {
      const tool = integrationActions.find((a) => a.name === name)!;
      expect(tool.method).toBe("GET");
      expect(tool.scope).toBe("workspace:read");
    }
    await expect(
      executeIntegrationAction(
        connection as never,
        "assistant_review_approve",
        { spaceId: space },
      ),
    ).rejects.toThrow(/Unknown/);
  });
  it("does not return a read result after grant revocation", async () => {
    f.connection
      .mockResolvedValueOnce(connection)
      .mockResolvedValueOnce(connection)
      .mockRejectedValueOnce(new Error("Grant revoked"));
    await expect(
      executeIntegrationAction(
        connection as never,
        "workspace_evidence_search",
        { spaceId: space },
      ),
    ).rejects.toThrow(/revoked/);
  });
  it("does not return content after the account loses its native workspace role", async () => {
    f.space
      .mockResolvedValueOnce({ id: space })
      .mockResolvedValueOnce({ id: space })
      .mockRejectedValueOnce(new Error("Native read role revoked"));
    await expect(
      executeIntegrationAction(
        connection as never,
        "workspace_evidence_search",
        { spaceId: space },
      ),
    ).rejects.toThrow(/role revoked/);
    expect(f.handle).toHaveBeenCalledTimes(1);
  });
});
