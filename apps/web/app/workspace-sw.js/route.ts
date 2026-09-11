import { workspaceServiceWorker } from "../../lib/workspace-service-worker";
export function GET() {
  return new Response(workspaceServiceWorker, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-cache", "service-worker-allowed": "/" } });
}
