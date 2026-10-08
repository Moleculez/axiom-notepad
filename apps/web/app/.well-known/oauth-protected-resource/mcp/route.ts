import { appUrl } from "@axiom/shared/auth";
import {
  checkMcpRequestBoundary,
  getMcpTransportConfig,
  mcpPreflight,
  withMcpCors,
} from "@axiom/shared/mcp-transport";
export function GET(request: Request) {
  const config = getMcpTransportConfig();
  const rejected = checkMcpRequestBoundary(request, config);
  return withMcpCors(
    request,
    rejected ??
      Response.json({
        resource: `${appUrl}/mcp`,
        authorization_servers: [`${appUrl}/api/auth`],
        scopes_supported: [
          "workspace:read",
          "workspace:write",
          "workspace:manage",
        ],
        bearer_methods_supported: ["header"],
        resource_name: "Axiom research workspace",
      }),
    config,
  );
}
export function OPTIONS(request: Request) {
  return mcpPreflight(request, getMcpTransportConfig(), { methods: ["GET"] });
}
