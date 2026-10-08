import { randomUUID } from "node:crypto";
import { z } from "zod";
import { HttpError } from "./access";
import type { McpErrorCategory } from "./mcp-transport";

/** Additive structured results; legacy clients can still parse the JSON text. */
export function mcpToolResult(value: unknown) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text, "utf8") > 4_000_000)
    throw new HttpError(
      413,
      "Result is too large. Narrow the query or use pagination.",
    );
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: { result: value },
  };
}

export function mcpFailure(error: unknown) {
  const requestId = randomUUID();
  const status =
    error instanceof z.ZodError
      ? 400
      : error instanceof HttpError
        ? error.status
        : 503;
  const category =
    (
      {
        400: "invalid_arguments",
        401: "authentication_required",
        403: "grant_denied",
        404: "not_found",
        409: "conflict",
        413: "size_limit",
        422: "invalid_arguments",
        429: "rate_limited",
      } as Record<number, McpErrorCategory>
    )[status] ?? "backend_unavailable";
  const message =
    error instanceof z.ZodError
      ? error.issues
          .map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`)
          .join("; ")
          .slice(0, 1200)
      : error instanceof HttpError && status < 500
        ? error.message.slice(0, 1200)
        : "The MCP service is temporarily unavailable. Retry, or share the request ID with the administrator.";
  return { status, category, message, requestId };
}

export function mcpToolError(error: unknown) {
  const failure = mcpFailure(error);
  return {
    ...mcpToolResult({
      error: failure.message,
      category: failure.category,
      requestId: failure.requestId,
    }),
    isError: true,
  };
}
