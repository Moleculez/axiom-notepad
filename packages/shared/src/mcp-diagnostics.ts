import {
  getMcpTransportConfig,
  MCP_MAX_BODY_BYTES,
  readMcpBody,
  type McpTransportConfig,
} from "./mcp-transport";
import { integrationActions, integrationScopes } from "./integration-catalog";

export type McpConnectionCheck = {
  checkedAt: string;
  healthy: boolean;
  code:
    | "ready"
    | "host_not_allowed"
    | "origin_not_allowed"
    | "connection_rejected"
    | "authentication_challenge_missing"
    | "backend_unavailable";
  message: string;
  httpStatus?: number;
};
export type McpServerStatus = {
  endpoint: string;
  canonicalOrigin: string;
  transport: "Streamable HTTP";
  authentication: "OAuth with PKCE";
  scopes: readonly string[];
  writesRequireReview: true;
  catalogActions: number;
  maxRequestBytes: number;
  maxChangeSetActions: number;
  developmentLoopbackAliases: boolean;
  check?: McpConnectionCheck;
};

export function mcpServerStatus(
  config: McpTransportConfig = getMcpTransportConfig(),
): McpServerStatus {
  return {
    endpoint: config.endpoint,
    canonicalOrigin: config.canonicalOrigin,
    transport: "Streamable HTTP",
    authentication: "OAuth with PKCE",
    scopes: integrationScopes,
    writesRequireReview: true,
    catalogActions: integrationActions.length,
    maxRequestBytes: MCP_MAX_BODY_BYTES,
    maxChangeSetActions: 50,
    developmentLoopbackAliases: config.developmentLoopbackAliases,
  };
}

/** Only the operator-configured endpoint is probed, with no cookies, tokens,
 * registration or redirects. This verifies reachability, not a user's grant. */
export async function checkMcpConnection(
  config: McpTransportConfig,
  fetcher: typeof fetch = fetch,
  parentSignal?: AbortSignal,
): Promise<McpConnectionCheck> {
  const checkedAt = new Date().toISOString();
  try {
    const timeout = AbortSignal.timeout(4_000);
    const signal = parentSignal
      ? AbortSignal.any([parentSignal, timeout])
      : timeout;
    const response = await fetcher(config.endpoint, {
      method: "GET",
      headers: { accept: "application/json, text/event-stream" },
      redirect: "manual",
      cache: "no-store",
      credentials: "omit",
      signal,
    });
    const httpStatus = response.status;
    const challenge = response.headers.get("www-authenticate") ?? "";
    const metadata = /(?:^|[\s,])resource_metadata="?([^"\s,]+)"?/i.exec(
      challenge,
    )?.[1];
    if (
      httpStatus === 401 &&
      /^Bearer\s/i.test(challenge) &&
      metadata ===
        `${config.canonicalOrigin}/.well-known/oauth-protected-resource/mcp`
    ) {
      await response.body?.cancel();
      return {
        checkedAt,
        healthy: true,
        code: "ready",
        message:
          "The endpoint is reachable and requests OAuth authentication. Connect your client, then review its workspace grants.",
        httpStatus,
      };
    }
    let code: Exclude<McpConnectionCheck["code"], "ready"> =
      httpStatus === 401
        ? "authentication_challenge_missing"
        : httpStatus === 403
          ? "connection_rejected"
          : "backend_unavailable";
    if (
      httpStatus === 403 &&
      response.headers.get("content-type")?.includes("application/json")
    ) {
      try {
        // Bound even error responses; never return untrusted response bodies.
        const body = await readMcpBody(
          new Request(config.endpoint, {
            method: "POST",
            body: response.body,
            signal,
            duplex: "half",
          } as RequestInit),
          4096,
        );
        const category: unknown = JSON.parse(body).code;
        if (
          category === "host_not_allowed" ||
          category === "origin_not_allowed"
        )
          code = category;
      } catch {
        // The public category is sufficient; HTML/backend details stay private.
      }
    } else await response.body?.cancel();
    const messages: Record<
      Exclude<McpConnectionCheck["code"], "ready">,
      string
    > = {
      host_not_allowed:
        "The proxy Host does not match the canonical endpoint. Preserve the public Host in the proxy and check APP_URL.",
      origin_not_allowed:
        "The request Origin is not allowed. Use the canonical endpoint or configure an explicit MCP browser origin.",
      connection_rejected:
        "The endpoint rejected its configured URL. Check the public Host, APP_URL and reverse-proxy configuration.",
      authentication_challenge_missing:
        "The endpoint returned 401 without an OAuth challenge. Check authentication middleware and proxy response headers.",
      backend_unavailable:
        "The endpoint did not return its expected authentication challenge. Check service health, proxy routing and TLS.",
    };
    return {
      checkedAt,
      healthy: false,
      code,
      message: messages[code],
      httpStatus,
    };
  } catch {
    return {
      checkedAt,
      healthy: false,
      code: "backend_unavailable",
      message:
        "The canonical endpoint could not be reached within four seconds. Check service health, DNS, TLS and proxy routing.",
    };
  }
}
