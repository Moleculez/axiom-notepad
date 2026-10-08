/** HTTP transport policy is independent of OAuth/session trust and document ACLs. */
export const MCP_MAX_BODY_BYTES = 5_500_000;
export type McpTransportConfig = {
  canonicalOrigin: string;
  endpoint: string;
  allowedOrigins: ReadonlySet<string>;
  allowedAuthorities: ReadonlySet<string>;
  developmentLoopbackAliases: boolean;
};
type McpEnvironment = {
  APP_URL?: string;
  BETTER_AUTH_URL?: string;
  NODE_ENV?: string;
  MCP_ALLOWED_ORIGINS?: string;
};
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A configuration origin is never a resource path, credential or wildcard. */
export function normalizeApplicationOrigin(value: string): string {
  const url = new URL(value.trim());
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    value.includes("*") ||
    /[\\\s]/.test(value.trim())
  )
    throw new Error("Application URL must be an exact HTTP(S) origin.");
  return url.origin;
}

export function getMcpTransportConfig(
  env: McpEnvironment = process.env,
): McpTransportConfig {
  const canonicalOrigin = normalizeApplicationOrigin(
    env.APP_URL ?? env.BETTER_AUTH_URL ?? "http://localhost:8080",
  );
  const canonical = new URL(canonicalOrigin);
  const allowedOrigins = new Set([canonicalOrigin]);
  for (const origin of (env.MCP_ALLOWED_ORIGINS ?? "").split(",")) {
    if (origin.trim()) allowedOrigins.add(normalizeApplicationOrigin(origin));
  }
  const developmentLoopbackAliases =
    env.NODE_ENV !== "production" && loopbackHosts.has(canonical.hostname);
  const allowedAuthorities = new Set([canonical.host]);
  if (developmentLoopbackAliases) {
    for (const host of loopbackHosts)
      allowedAuthorities.add(
        new URL(
          `${canonical.protocol}//${host}${canonical.port ? `:${canonical.port}` : ""}`,
        ).host,
      );
  }
  return {
    canonicalOrigin,
    endpoint: `${canonicalOrigin}/mcp`,
    allowedOrigins,
    allowedAuthorities,
    developmentLoopbackAliases,
  };
}

export type McpErrorCategory =
  | "host_not_allowed"
  | "origin_not_allowed"
  | "invalid_preflight"
  | "body_too_large"
  | "invalid_body"
  | "request_aborted"
  | "rate_limited"
  | "authentication_required"
  | "grant_denied"
  | "stale_grant"
  | "invalid_protocol"
  | "invalid_arguments"
  | "not_found"
  | "conflict"
  | "size_limit"
  | "backend_unavailable";

export class McpTransportError extends Error {
  constructor(
    public readonly category: McpErrorCategory,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export function mcpErrorResponse(
  category: McpErrorCategory,
  message: string,
  status: number,
  options: { retryAfter?: number; requestId?: string } = {},
): Response {
  const requestId = options.requestId ?? crypto.randomUUID();
  return Response.json(
    { error: message, code: category, requestId },
    {
      status,
      headers: {
        "cache-control": "no-store",
        "x-request-id": requestId,
        ...(options.retryAfter !== undefined
          ? { "retry-after": String(options.retryAfter) }
          : {}),
      },
    },
  );
}

function requestOrigin(request: Request): string | null {
  const raw = request.headers.get("origin");
  if (raw === null) return null;
  // Origin headers contain a serialized origin, not URLs with a slash/path.
  if (raw === "null" || raw.endsWith("/")) return "invalid";
  try {
    return normalizeApplicationOrigin(raw);
  } catch {
    return "invalid";
  }
}

/** Next.js request.url can name its internal listener behind a reverse proxy.
 * Validate the actual Host. Never substitute Forwarded/X-Forwarded-Host. */
export function checkMcpRequestBoundary(
  request: Request,
  config: McpTransportConfig,
): Response | null {
  const host = request.headers.get("host") ?? new URL(request.url).host;
  let authority: string;
  try {
    if (!host || host.endsWith(":") || /[\s,/@?#\\]/.test(host))
      throw new Error("Invalid host");
    const url = new URL(`${new URL(config.canonicalOrigin).protocol}//${host}`);
    const literalHostname = host.startsWith("[")
      ? host.slice(0, host.indexOf("]") + 1)
      : host.split(":")[0];
    if (url.pathname !== "/" || url.username || url.password)
      throw new Error("Invalid host");
    // Do not silently accept encoded names or alternative numeric-IP spellings.
    if (literalHostname.toLowerCase() !== url.hostname)
      throw new Error("Invalid host");
    authority = url.host;
  } catch {
    return mcpErrorResponse(
      "host_not_allowed",
      "Origin or host is not allowed.",
      403,
    );
  }
  if (!config.allowedAuthorities.has(authority))
    return mcpErrorResponse(
      "host_not_allowed",
      "Origin or host is not allowed.",
      403,
    );
  const origin = requestOrigin(request);
  if (origin !== null && !config.allowedOrigins.has(origin))
    return mcpErrorResponse(
      "origin_not_allowed",
      "Origin or host is not allowed.",
      403,
    );
  return null;
}

const allowedRequestHeaders = new Set([
  "accept",
  "authorization",
  "content-type",
  "last-event-id",
  "mcp-protocol-version",
  "mcp-session-id",
]);
export function withMcpCors(
  request: Request,
  response: Response,
  config: McpTransportConfig,
): Response {
  const origin = requestOrigin(request);
  if (origin === null || !config.allowedOrigins.has(origin)) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set(
    "access-control-expose-headers",
    "WWW-Authenticate, Retry-After, MCP-Session-Id, MCP-Protocol-Version, X-Request-Id",
  );
  const vary = headers.get("vary");
  if (!vary?.split(",").some((item) => item.trim().toLowerCase() === "origin"))
    headers.set("vary", vary ? `${vary}, Origin` : "Origin");
  // No credentialed cookie requests: MCP authenticates explicit Bearer tokens.
  headers.delete("access-control-allow-credentials");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function mcpPreflight(
  request: Request,
  config: McpTransportConfig,
  options: { methods?: readonly string[] } = {},
): Response {
  const rejected = checkMcpRequestBoundary(request, config);
  if (rejected) return withMcpCors(request, rejected, config);
  const method = request.headers.get("access-control-request-method");
  const allowedMethods = options.methods ?? ["POST", "GET", "DELETE"];
  const requestedHeaders = (
    request.headers.get("access-control-request-headers") ?? ""
  )
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  if (
    requestOrigin(request) === null ||
    !allowedMethods.includes(method ?? "") ||
    requestedHeaders.some((header) => !allowedRequestHeaders.has(header))
  )
    return withMcpCors(
      request,
      mcpErrorResponse(
        "invalid_preflight",
        "This MCP preflight request is not allowed.",
        403,
      ),
      config,
    );
  return withMcpCors(
    request,
    new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-methods": [...allowedMethods, "OPTIONS"].join(
          ", ",
        ),
        "access-control-allow-headers": [...allowedRequestHeaders].join(", "),
        "access-control-max-age": "600",
        "cache-control": "no-store",
        vary: "Access-Control-Request-Method, Access-Control-Request-Headers",
      },
    }),
    config,
  );
}

/** Bound bytes before decoding/parsing; Content-Length is only an early check. */
export async function readMcpBody(
  request: Request,
  maxBytes = MCP_MAX_BODY_BYTES,
): Promise<string> {
  const length = request.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > maxBytes)
    throw new McpTransportError(
      "body_too_large",
      "MCP request is too large.",
      413,
    );
  if (request.signal.aborted)
    throw new McpTransportError(
      "request_aborted",
      "MCP request was canceled.",
      499,
    );
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  request.signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (request.signal.aborted)
        throw new McpTransportError(
          "request_aborted",
          "MCP request was canceled.",
          499,
        );
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new McpTransportError(
          "body_too_large",
          "MCP request is too large.",
          413,
        );
      }
      chunks.push(value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(body);
    } catch {
      throw new McpTransportError(
        "invalid_body",
        "MCP request must use valid UTF-8.",
        400,
      );
    }
  } finally {
    request.signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

/** Per-process burst protection; authenticated call ledgers remain authoritative.
 * Do not key this limiter on spoofable forwarded IP headers. */
export function createMcpTransportLimiter(
  options: {
    limit?: number;
    windowMs?: number;
    maxKeys?: number;
    now?: () => number;
  } = {},
) {
  const limit = options.limit ?? 600;
  const windowMs = options.windowMs ?? 60_000;
  const maxKeys = options.maxKeys ?? 2_000;
  const now = options.now ?? Date.now;
  const buckets = new Map<string, { count: number; reset: number }>();
  return (key = "transport") => {
    const time = now();
    for (const [id, bucket] of buckets)
      if (bucket.reset <= time) buckets.delete(id);
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= maxKeys) {
        // Refuse new buckets until an existing one expires rather than evicting
        // active limits, which would let key churn reset enforcement.
        const reset = Math.min(
          ...[...buckets.values()].map((item) => item.reset),
        );
        return {
          allowed: false,
          retryAfter: Math.max(1, Math.ceil((reset - time) / 1000)),
        };
      }
      bucket = { count: 0, reset: time + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    return {
      allowed: bucket.count <= limit,
      retryAfter: Math.max(1, Math.ceil((bucket.reset - time) / 1000)),
    };
  };
}
