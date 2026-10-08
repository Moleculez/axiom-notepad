import { describe, expect, it, vi } from "vitest";
import {
  checkMcpConnection,
  mcpServerStatus,
} from "../packages/shared/src/mcp-diagnostics";
import { getMcpTransportConfig } from "../packages/shared/src/mcp-transport";

const config = getMcpTransportConfig({
  APP_URL: "https://notes.axiom.test",
  NODE_ENV: "production",
});
describe("MCP setup diagnostics", () => {
  it("reports canonical identity and capabilities without making a network request", () => {
    const status = mcpServerStatus(config);
    expect(status.endpoint).toBe("https://notes.axiom.test/mcp");
    expect(status.writesRequireReview).toBe(true);
    expect(status.maxRequestBytes).toBe(5_500_000);
    expect(status.maxChangeSetActions).toBe(50);
    expect(status.catalogActions).toBeGreaterThan(90);
    expect(status.check).toBeUndefined();
  });
  it("probes only the operator endpoint with no credentials, redirects or registration", async () => {
    const fetcher = vi.fn(
      async (_url: string | URL | Request, _options?: RequestInit) =>
        Response.json(
          { error: "Authentication required" },
          {
            status: 401,
            headers: {
              "www-authenticate":
                'Bearer resource_metadata="https://notes.axiom.test/.well-known/oauth-protected-resource/mcp"',
            },
          },
        ),
    );
    const result = await checkMcpConnection(config, fetcher);
    expect(result).toMatchObject({
      healthy: true,
      code: "ready",
      httpStatus: 401,
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      config.endpoint,
      expect.objectContaining({
        method: "GET",
        credentials: "omit",
        redirect: "manual",
        cache: "no-store",
      }),
    );
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty("body");
    expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty(
      "authorization",
    );
  });
  it.each(["host_not_allowed", "origin_not_allowed"])(
    "turns %s into actionable recovery without returning arbitrary backend text",
    async (code) => {
      const result = await checkMcpConnection(config, async () =>
        Response.json(
          { code, error: "postgres://private:secret@db" },
          { status: 403 },
        ),
      );
      expect(result).toMatchObject({ healthy: false, code, httpStatus: 403 });
      expect(result.message).not.toContain("secret");
      expect(result.message).not.toContain("postgres");
    },
  );
  it("requires an authentication challenge and never follows redirects", async () => {
    expect(
      await checkMcpConnection(
        config,
        async () => new Response(null, { status: 401 }),
      ),
    ).toMatchObject({
      healthy: false,
      code: "authentication_challenge_missing",
    });
    for (const challenge of [
      'Basic realm="wrong-service"',
      'Bearer resource_metadata="https://attacker.axiom.test/metadata"',
    ])
      expect(
        await checkMcpConnection(
          config,
          async () =>
            new Response(null, {
              status: 401,
              headers: { "www-authenticate": challenge },
            }),
        ),
      ).toMatchObject({
        healthy: false,
        code: "authentication_challenge_missing",
      });
    expect(
      await checkMcpConnection(
        config,
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://attacker.axiom.test" },
          }),
      ),
    ).toMatchObject({
      healthy: false,
      code: "backend_unavailable",
      httpStatus: 302,
    });
  });
  it("sanitizes network errors and oversized proxy bodies", async () => {
    const result = await checkMcpConnection(config, async () => {
      throw new Error("token=private-secret");
    });
    expect(result.code).toBe("backend_unavailable");
    expect(result.message).not.toContain("private-secret");
    const large = await checkMcpConnection(config, async () =>
      Response.json({ error: "x".repeat(5000) }, { status: 403 }),
    );
    expect(large.code).toBe("connection_rejected");
    expect(large.message.length).toBeLessThan(300);
  });
});
