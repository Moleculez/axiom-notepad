import { createMcpHandler } from "@modelcontextprotocol/server";
import { requireMcpAuth } from "@better-auth/mcp";
import { auth, appUrl } from "@axiom/shared/auth";
import { query } from "@axiom/shared/db";
import {
  activeConnection,
  type IntegrationConnection,
} from "@axiom/shared/integration-security";
import { mcpFailure } from "@axiom/shared/mcp-results";
import {
  checkMcpRequestBoundary,
  createMcpTransportLimiter,
  getMcpTransportConfig,
  mcpErrorResponse,
  mcpPreflight,
  readMcpBody,
  withMcpCors,
  McpTransportError,
} from "@axiom/shared/mcp-transport";
import { createWorkspaceMcpServer } from "../../lib/mcp-server";

export const runtime = "nodejs";
// Process-local abuse protection, including initialize/discovery. No forwarded
// client address is trusted. Deployment-wide limiting belongs at the proxy.
const transportLimit = createMcpTransportLimiter();
const connectionLimit = createMcpTransportLimiter({ limit: 120 });
const protect = requireMcpAuth(
  auth,
  async (request, claims) => {
    try {
      const clientId = String(claims.azp ?? claims.client_id ?? ""),
        userId = String(claims.sub ?? "");
      const [found] = await query<IntegrationConnection>(
        "SELECT * FROM integration_connections WHERE user_id=$1 AND client_id=$2 AND revoked_at IS NULL",
        [userId, clientId],
      );
      if (!found)
        return mcpErrorResponse(
          "grant_denied",
          "Approve this application and its workspaces in Axiom before connecting.",
          403,
        );
      const connection = await activeConnection(found.id, userId);
      if (
        !claims.axiom_grants ||
        typeof claims.axiom_grants !== "object" ||
        (claims.axiom_grants as Record<string, unknown>)[connection.id] !==
          connection.grant_version
      ) {
        const response = mcpErrorResponse(
          "stale_grant",
          "Consent changed. Obtain a new access token.",
          401,
        );
        response.headers.set(
          "www-authenticate",
          `Bearer resource_metadata="${appUrl}/.well-known/oauth-protected-resource/mcp", error="invalid_token"`,
        );
        return response;
      }
      const tokenScopes = new Set(String(claims.scope ?? "").split(" "));
      const scopes = connection.scopes.filter((s) => tokenScopes.has(s));
      if (!scopes.includes("workspace:read"))
        return mcpErrorResponse(
          "grant_denied",
          "This connection requires workspace:read.",
          403,
        );
      const limit = connectionLimit(connection.id);
      if (!limit.allowed)
        return mcpErrorResponse(
          "rate_limited",
          "Connection rate limit reached. Retry later.",
          429,
          { retryAfter: limit.retryAfter },
        );
      const body = await readMcpBody(request);
      return await createMcpHandler(
        () =>
          createWorkspaceMcpServer(
            connection,
            scopes as Parameters<typeof createWorkspaceMcpServer>[1],
            appUrl,
          ),
        { legacy: "stateless" },
      ).fetch(
        new Request(request.url, {
          method: request.method,
          headers: request.headers,
          ...(body ? { body } : {}),
          signal: request.signal,
        }),
      );
    } catch (error) {
      if (error instanceof McpTransportError)
        return mcpErrorResponse(error.category, error.message, error.status);
      const failure = mcpFailure(error);
      return mcpErrorResponse(
        failure.category,
        failure.message,
        failure.status,
        { requestId: failure.requestId },
      );
    }
  },
  { resource: `${appUrl}/mcp`, requiredScopes: ["workspace:read"] },
);

async function handle(request: Request) {
  try {
    const config = getMcpTransportConfig();
    const boundary = checkMcpRequestBoundary(request, config);
    if (boundary) return withMcpCors(request, boundary, config);
    const limit = transportLimit();
    if (!limit.allowed)
      return withMcpCors(
        request,
        mcpErrorResponse(
          "rate_limited",
          "MCP transport is busy. Retry later.",
          429,
          { retryAfter: limit.retryAfter },
        ),
        config,
      );
    if (request.method === "OPTIONS") return mcpPreflight(request, config);
    return withMcpCors(request, await protect(request), config);
  } catch (error) {
    const failure = mcpFailure(error);
    return mcpErrorResponse(failure.category, failure.message, failure.status, {
      requestId: failure.requestId,
    });
  }
}
export { handle as POST, handle as GET, handle as DELETE, handle as OPTIONS };
