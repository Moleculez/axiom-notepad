import { appUrl } from "@axiom/shared/auth";
export function GET(){return Response.json({resource:`${appUrl}/mcp`,authorization_servers:[`${appUrl}/api/auth`],scopes_supported:["workspace:read","workspace:write","workspace:manage"],bearer_methods_supported:["header"],resource_name:"Axiom research workspace"});}
