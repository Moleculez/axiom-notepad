import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  query: vi.fn(),
  active: vi.fn(),
  scope: "workspace:read",
  revision: "g1",
}));
vi.mock("@axiom/shared/auth", () => ({
  auth: {},
  appUrl: "https://research.axiom.test",
}));
vi.mock("@axiom/shared/db", () => ({ query: f.query }));
vi.mock("@axiom/shared/integration-security", () => ({
  activeConnection: f.active,
}));
vi.mock("@better-auth/mcp", () => ({
  requireMcpAuth:
    (
      _auth: unknown,
      handler: (request: Request, claims: unknown) => Promise<Response>,
    ) =>
    (request: Request) => {
      if (!request.headers.has("authorization"))
        return new Response(null, {
          status: 401,
          headers: {
            "www-authenticate":
              'Bearer resource_metadata="https://research.axiom.test/.well-known/oauth-protected-resource/mcp"',
          },
        });
      return handler(request, {
        sub: "owner",
        azp: "fixture",
        scope: f.scope,
        axiom_grants: { connection: f.revision },
      });
    },
}));
vi.mock("../apps/web/lib/mcp-server", async () => {
  const { McpServer } = await import("@modelcontextprotocol/server");
  return {
    createWorkspaceMcpServer: () =>
      new McpServer({ name: "isolated-test", version: "1" }),
  };
});
import { GET, POST, OPTIONS } from "../apps/web/app/mcp/route";
const connection = {
  id: "connection",
  user_id: "owner",
  scopes: ["workspace:read"],
  space_ids: [],
  grant_version: "g1",
};
const request = (
  method = "GET",
  headers: Record<string, string> = {},
  body?: string,
) =>
  new Request("http://localhost:8080/mcp", {
    method,
    headers: { host: "research.axiom.test", ...headers },
    ...(body ? { body } : {}),
  });
const initialize = () =>
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      clientInfo: { name: "fixture", version: "1" },
      capabilities: {},
    },
  });
beforeEach(() => {
  vi.stubEnv("APP_URL", "https://research.axiom.test");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("MCP_ALLOWED_ORIGINS", "https://course.axiom.test");
  vi.resetAllMocks();
  f.revision = "g1";
  f.scope = "workspace:read";
  f.query.mockResolvedValue([connection]);
  f.active.mockResolvedValue(connection);
});
afterEach(() => vi.unstubAllEnvs());
describe("MCP route public authority and OAuth boundary", () => {
  it("reaches the 401 OAuth challenge with a public Host and an internal Next URL", async () => {
    const result = await GET(request());
    expect(result.status).toBe(401);
    expect(result.headers.get("www-authenticate")).toContain(
      "oauth-protected-resource/mcp",
    );
    expect(f.query).not.toHaveBeenCalled();
  });
  it("initializes the real SDK behind the proxy instead of rejecting the internal URL", async () => {
    const result = await POST(
      request(
        "POST",
        {
          authorization: "Bearer fixture",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
        },
        initialize(),
      ),
    );
    expect(result.status, await result.text()).toBe(200);
  });
  it("rejects hostile Host even when forwarded headers claim the canonical authority", async () => {
    const result = await GET(
      request("GET", {
        host: "attacker.test",
        "x-forwarded-host": "research.axiom.test",
        forwarded: "host=research.axiom.test",
      }),
    );
    expect(result.status).toBe(403);
    expect((await result.json()).code).toBe("host_not_allowed");
  });
  it("allows configured browser Origin and exposes OAuth challenge without credentials", async () => {
    const result = await GET(
      request("GET", { origin: "https://course.axiom.test" }),
    );
    expect(result.status).toBe(401);
    expect(result.headers.get("access-control-allow-origin")).toBe(
      "https://course.axiom.test",
    );
    expect(result.headers.get("access-control-expose-headers")).toContain(
      "WWW-Authenticate",
    );
    expect(result.headers.has("access-control-allow-credentials")).toBe(false);
    const foreign = await GET(
      request("GET", { origin: "https://attacker.test" }),
    );
    expect(foreign.status).toBe(403);
    expect(foreign.headers.has("access-control-allow-origin")).toBe(false);
  });
  it("answers allowlisted preflight without starting OAuth or registering a client", async () => {
    const result = await OPTIONS(
      request("OPTIONS", {
        origin: "https://course.axiom.test",
        "access-control-request-method": "POST",
        "access-control-request-headers":
          "Authorization, Content-Type, MCP-Protocol-Version",
      }),
    );
    expect(result.status).toBe(204);
    expect(f.query).not.toHaveBeenCalled();
  });
  it("returns an actionable stale-consent challenge and sanitizes database outages", async () => {
    f.revision = "old";
    const stale = await POST(
      request("POST", { authorization: "Bearer fixture" }, initialize()),
    );
    expect(stale.status).toBe(401);
    expect(stale.headers.get("www-authenticate")).toContain(
      'error="invalid_token"',
    );
    f.revision = "g1";
    f.query.mockRejectedValue(
      new Error("postgres://secret@private-host/database"),
    );
    const outage = await GET(
      request("GET", { authorization: "Bearer fixture" }),
    );
    expect(outage.status).toBe(503);
    const body = await outage.text();
    expect(body).not.toContain("secret");
    expect(body).toContain("requestId");
  });
  it("enforces the byte limit before parsing authorized JSON", async () => {
    const result = await POST(
      request(
        "POST",
        { authorization: "Bearer fixture" },
        "字".repeat(1_850_000),
      ),
    );
    expect(result.status).toBe(413);
    expect((await result.json()).code).toBe("body_too_large");
  });
  it("counts initialization/discovery requests in the connection throttle", async () => {
    let limited: Response | undefined;
    for (let i = 0; i < 130; i++) {
      const result = await GET(
        request("GET", { authorization: "Bearer fixture" }),
      );
      if (result.status === 429) {
        limited = result;
        break;
      }
    }
    expect(limited?.status).toBe(429);
    expect(limited?.headers.get("retry-after")).toBeTruthy();
  });
});
