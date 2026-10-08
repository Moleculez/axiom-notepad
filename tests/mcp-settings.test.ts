import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mcpServerStatus } from "../packages/shared/src/mcp-diagnostics";
import { getMcpTransportConfig } from "../packages/shared/src/mcp-transport";

const state = vi.hoisted(() => ({ status: null as unknown }));
vi.mock("../apps/web/components/workspace/ui", () => ({
  useLocation: () => ({ params: new URLSearchParams() }),
  useWorkspace: () => ({ spaces: [], notify: vi.fn() }),
  useData: (path: string) => ({
    data:
      path === "connections/mcp-status"
        ? state.status
        : path === "connections"
          ? { connections: [], approvals: [], activity: [] }
          : [],
    loading: !state.status && path === "connections/mcp-status",
    error: "",
    revalidate: vi.fn(),
    reload: vi.fn(),
  }),
  Loading: () => null,
  ErrorNotice: () => null,
}));
vi.mock("../apps/web/components/assistant/ChangeSetReview", () => ({
  default: () => null,
}));
vi.mock("../apps/web/lib/client", () => ({ api: vi.fn(), post: vi.fn() }));
import ConnectionsSettings from "../apps/web/components/workspace/ConnectionsSettings";

afterEach(() => vi.unstubAllGlobals());
describe("Connected apps MCP setup presentation", () => {
  it("copies the server-reported canonical endpoint, not the browser alias", () => {
    state.status = mcpServerStatus(
      getMcpTransportConfig({ APP_URL: "https://notes.axiom.test" }),
    );
    vi.stubGlobal("location", { origin: "https://alias.axiom.test" });
    const html = renderToStaticMarkup(createElement(ConnectionsSettings));
    expect(html).toContain("https://notes.axiom.test/mcp");
    expect(html).not.toContain("https://alias.axiom.test/mcp");
    expect(html).toContain("alias does not change the token audience");
    expect(html).toContain("Copy MCP server URL");
    expect(html).toContain("Check connection");
    expect(html).toContain("In-app review before every write");
  });
  it("keeps unavailable canonical endpoints uncopyable", () => {
    state.status = null;
    const html = renderToStaticMarkup(createElement(ConnectionsSettings));
    expect(html).toContain("Loading canonical endpoint");
    expect(html).toMatch(
      /<button[^>]*aria-label="Copy MCP server URL"[^>]*disabled/,
    );
  });
  it("announces actionable check results without claiming consent is already granted", () => {
    state.status = {
      ...mcpServerStatus(
        getMcpTransportConfig({ APP_URL: "https://notes.axiom.test" }),
      ),
      check: {
        healthy: false,
        code: "host_not_allowed",
        message: "Preserve the public Host in the reverse proxy.",
        checkedAt: "2026-10-08T10:00:00Z",
        httpStatus: 403,
      },
    };
    const html = renderToStaticMarkup(createElement(ConnectionsSettings));
    expect(html).toContain("Connection needs attention");
    expect(html).toContain("Preserve the public Host");
    expect(html).toContain("HTTP 403");
    expect(html).toContain('role="status"');
    expect(html).toContain("without accessing files or changing permissions");
  });
});
