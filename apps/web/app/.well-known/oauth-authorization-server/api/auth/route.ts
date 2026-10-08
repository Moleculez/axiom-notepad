import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { auth } from "@axiom/shared/auth";
import {
  checkMcpRequestBoundary,
  getMcpTransportConfig,
  mcpPreflight,
  withMcpCors,
} from "@axiom/shared/mcp-transport";
const metadata = oauthProviderAuthServerMetadata(auth);
export async function GET(request: Request) {
  const config = getMcpTransportConfig();
  const rejected = checkMcpRequestBoundary(request, config);
  return withMcpCors(request, rejected ?? (await metadata(request)), config);
}
export function OPTIONS(request: Request) {
  return mcpPreflight(request, getMcpTransportConfig(), { methods: ["GET"] });
}
