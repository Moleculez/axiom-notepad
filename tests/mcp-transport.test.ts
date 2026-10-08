import { describe, expect, it } from "vitest";
import {
  checkMcpRequestBoundary,
  createMcpTransportLimiter,
  getMcpTransportConfig,
  mcpErrorResponse,
  mcpPreflight,
  normalizeApplicationOrigin,
  readMcpBody,
  withMcpCors,
} from "../packages/shared/src/mcp-transport";

const publicConfig = getMcpTransportConfig({
  APP_URL: "https://notes.axiom.test/",
  NODE_ENV: "production",
  MCP_ALLOWED_ORIGINS: "https://assistant.axiom.test",
});
const request = (
  headers: HeadersInit = {},
  url = "http://localhost:3000/mcp",
) => new Request(url, { headers });

describe("MCP authority and Origin boundary", () => {
  it("validates public Host rather than the internal Next.js request URL", () => {
    expect(
      checkMcpRequestBoundary(
        request({ host: "notes.axiom.test" }),
        publicConfig,
      ),
    ).toBeNull();
    expect(publicConfig.canonicalOrigin).toBe("https://notes.axiom.test");
    expect(publicConfig.endpoint).toBe("https://notes.axiom.test/mcp");
  });
  it("uses URL authority only when Host is absent", () => {
    expect(
      checkMcpRequestBoundary(request({}, publicConfig.endpoint), publicConfig),
    ).toBeNull();
    expect(checkMcpRequestBoundary(request(), publicConfig)?.status).toBe(403);
  });
  it.each([
    "attacker.axiom.test",
    "notes.axiom.test:8080",
    "notes.axiom.test, attacker.axiom.test",
    "user@notes.axiom.test",
    "notes.axiom.test/path",
    "notes.axiom.test?other",
    "notes.axiom.test:",
    "%6Eotes.axiom.test",
    "[::1]:3000",
  ])(
    "rejects an invalid authority %s even with forged forwarding headers",
    (host) => {
      expect(
        checkMcpRequestBoundary(
          request({
            host,
            "x-forwarded-host": "notes.axiom.test",
            forwarded: "host=notes.axiom.test;proto=https",
          }),
          publicConfig,
        )?.status,
      ).toBe(403);
    },
  );
  it("ignores forwarded hosts even when they look hostile", () => {
    expect(
      checkMcpRequestBoundary(
        request({
          host: "notes.axiom.test",
          "x-forwarded-host": "attacker.axiom.test",
        }),
        publicConfig,
      ),
    ).toBeNull();
  });
  it.each([
    "null",
    "https://attacker.axiom.test",
    "https://notes.axiom.test:8080",
    "https://notes.axiom.test/",
    "https://notes.axiom.test/path",
    "https://user:pass@notes.axiom.test",
    "https://notes.axiom.test#fragment",
    "https://notes.axiom.test https://assistant.axiom.test",
  ])("rejects invalid/foreign Origin %s", async (origin) => {
    const rejected = checkMcpRequestBoundary(
      request({ host: "notes.axiom.test", origin }),
      publicConfig,
    )!;
    expect(rejected.status).toBe(403);
    expect(await rejected.json()).toMatchObject({ code: "origin_not_allowed" });
  });
  it.each(["https://notes.axiom.test", "https://assistant.axiom.test"])(
    "permits explicit browser Origin %s without changing OAuth identity",
    (origin) => {
      expect(
        checkMcpRequestBoundary(
          request({ host: "notes.axiom.test", origin }),
          publicConfig,
        ),
      ).toBeNull();
      expect(publicConfig.endpoint).toBe("https://notes.axiom.test/mcp");
    },
  );
  it.each(["localhost:8080", "127.0.0.1:8080", "[::1]:8080"])(
    "permits same-port development loopback transport %s",
    (host) => {
      const config = getMcpTransportConfig({
        APP_URL: "http://localhost:8080",
        NODE_ENV: "development",
      });
      expect(checkMcpRequestBoundary(request({ host }), config)).toBeNull();
      expect(config.endpoint).toBe("http://localhost:8080/mcp");
      expect(
        checkMcpRequestBoundary(
          request({ host: host.replace("8080", "8081") }),
          config,
        )?.status,
      ).toBe(403);
    },
  );
  it("does not enable aliases in production or for a non-loopback canonical URL", () => {
    for (const env of [
      { APP_URL: "http://localhost:8080", NODE_ENV: "production" },
      { APP_URL: "https://notes.axiom.test", NODE_ENV: "development" },
    ]) {
      const config = getMcpTransportConfig(env);
      expect(config.developmentLoopbackAliases).toBe(false);
      expect(
        checkMcpRequestBoundary(request({ host: "127.0.0.1:8080" }), config)
          ?.status,
      ).toBe(403);
    }
  });
  it("keeps development aliases out of the browser Origin allowlist", () => {
    const config = getMcpTransportConfig({
      APP_URL: "http://localhost:8080",
      NODE_ENV: "development",
    });
    expect(
      checkMcpRequestBoundary(
        request({ host: "127.0.0.1:8080", origin: "http://127.0.0.1:8080" }),
        config,
      )?.status,
    ).toBe(403);
  });
  it.each(["127.1:8080", "2130706433:8080", "0x7f000001:8080"])(
    "rejects nonliteral loopback authority %s",
    (host) => {
      const config = getMcpTransportConfig({
        APP_URL: "http://localhost:8080",
        NODE_ENV: "development",
      });
      expect(checkMcpRequestBoundary(request({ host }), config)?.status).toBe(
        403,
      );
    },
  );
  it("uses the documented development default and rejects unsafe configured origins", () => {
    expect(getMcpTransportConfig({}).endpoint).toBe(
      "http://localhost:8080/mcp",
    );
    for (const value of [
      "https://*.axiom.test",
      "https://notes.axiom.test/mcp",
      "https://notes.axiom.test?query",
      "https://user:pass@notes.axiom.test",
      "null",
      "file:///tmp/notes",
      "https://notes.axiom.test\\other",
    ])
      expect(() => normalizeApplicationOrigin(value)).toThrow();
  });
});

describe("MCP browser CORS", () => {
  const browserRequest = (headers: HeadersInit = {}) =>
    new Request("http://localhost:3000/mcp", {
      method: "OPTIONS",
      headers: {
        host: "notes.axiom.test",
        origin: "https://assistant.axiom.test",
        "access-control-request-method": "POST",
        ...headers,
      },
    });
  it("accepts only the documented transport methods and headers", () => {
    const response = mcpPreflight(
      browserRequest({
        "access-control-request-headers":
          "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id",
      }),
      publicConfig,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://assistant.axiom.test",
    );
    expect(response.headers.has("access-control-allow-credentials")).toBe(
      false,
    );
    expect(response.headers.get("vary")).toContain("Origin");
    expect(
      mcpPreflight(
        browserRequest({ "access-control-request-method": "PUT" }),
        publicConfig,
      ).status,
    ).toBe(403);
    expect(
      mcpPreflight(
        browserRequest({ "access-control-request-headers": "X-Custom-Secret" }),
        publicConfig,
      ).status,
    ).toBe(403);
    expect(
      mcpPreflight(
        browserRequest({ origin: "https://attacker.axiom.test" }),
        publicConfig,
      ).headers.has("access-control-allow-origin"),
    ).toBe(false);
  });
  it("exposes OAuth challenges and preserves error/status/body without cookie credentials", async () => {
    const response = withMcpCors(
      browserRequest(),
      Response.json(
        { error: "Authenticate" },
        {
          status: 401,
          headers: {
            "www-authenticate":
              'Bearer resource_metadata="https://notes.axiom.test/.well-known/oauth-protected-resource/mcp"',
            vary: "Accept",
            "access-control-allow-credentials": "true",
          },
        },
      ),
      publicConfig,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-expose-headers")).toContain(
      "WWW-Authenticate",
    );
    expect(response.headers.get("vary")).toBe("Accept, Origin");
    expect(response.headers.has("access-control-allow-credentials")).toBe(
      false,
    );
    expect(await response.json()).toEqual({ error: "Authenticate" });
  });
});

describe("MCP request bounds and throttling", () => {
  it("counts UTF-8 bytes rather than characters and enforces claimed and streamed length", async () => {
    await expect(
      readMcpBody(
        new Request("http://localhost/mcp", { method: "POST", body: "😀" }),
        4,
      ),
    ).resolves.toBe("😀");
    await expect(
      readMcpBody(
        new Request("http://localhost/mcp", { method: "POST", body: "😀" }),
        3,
      ),
    ).rejects.toMatchObject({ category: "body_too_large", status: 413 });
    await expect(
      readMcpBody(
        new Request("http://localhost/mcp", {
          method: "POST",
          body: "a",
          headers: { "content-length": "9" },
        }),
        8,
      ),
    ).rejects.toMatchObject({ category: "body_too_large" });
  });
  it("rejects corrupt UTF-8 and honors cancellation while reading", async () => {
    await expect(
      readMcpBody(
        new Request("http://localhost/mcp", {
          method: "POST",
          body: new Uint8Array([0xff]),
        }),
      ),
    ).rejects.toMatchObject({ category: "invalid_body", status: 400 });
    const controller = new AbortController();
    let canceled = false;
    const body = new ReadableStream({
      cancel() {
        canceled = true;
      },
    });
    const req = new Request("http://localhost/mcp", {
      method: "POST",
      body,
      signal: controller.signal,
      duplex: "half",
    } as RequestInit);
    const pending = readMcpBody(req);
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      category: "request_aborted",
    });
    expect(canceled).toBe(true);
  });
  it("bounds key storage without evicting an active limit, then resets expired windows", () => {
    let time = 1_000;
    const limit = createMcpTransportLimiter({
      limit: 2,
      windowMs: 5_000,
      maxKeys: 1,
      now: () => time,
    });
    expect(limit("a").allowed).toBe(true);
    expect(limit("a").allowed).toBe(true);
    expect(limit("a")).toEqual({ allowed: false, retryAfter: 5 });
    expect(limit("b").allowed).toBe(false);
    time += 5_000;
    expect(limit("b").allowed).toBe(true);
  });
  it("returns stable categories and correlation IDs without backend details", async () => {
    const response = mcpErrorResponse(
      "backend_unavailable",
      "Service temporarily unavailable.",
      503,
      { requestId: "fixture", retryAfter: 3 },
    );
    expect(response.headers.get("x-request-id")).toBe("fixture");
    expect(response.headers.get("retry-after")).toBe("3");
    expect(await response.json()).toEqual({
      error: "Service temporarily unavailable.",
      code: "backend_unavailable",
      requestId: "fixture",
    });
  });
});
