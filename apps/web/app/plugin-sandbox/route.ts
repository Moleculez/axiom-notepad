import { randomBytes } from "node:crypto";
import {
  pluginSandboxCsp,
  pluginSandboxDocument,
} from "@axiom/shared/plugin-sandbox";
import { pluginsEnabled } from "@axiom/shared/plugin-security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  const url = new URL(request.url),
    nonce = url.searchParams.get("nonce");
  if (!pluginsEnabled() || !nonce || !/^[a-f0-9-]{36}$/.test(nonce))
    return new Response("Not found", { status: 404 });
  const scriptNonce = randomBytes(24).toString("base64");
  return new Response(pluginSandboxDocument(nonce, url.origin, scriptNonce), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "content-security-policy": pluginSandboxCsp(scriptNonce),
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      // Only the trusted sandbox endpoint may be framed by the app. Other
      // routes retain the global DENY policy.
      "x-frame-options": "SAMEORIGIN",
      "permissions-policy":
        "camera=(), microphone=(), geolocation=(), display-capture=(), clipboard-read=(), clipboard-write=(), fullscreen=()",
    },
  });
}
