import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
export const dynamic = "force-dynamic";
export async function GET() {
  const cwd = process.cwd(), root = cwd.endsWith("/apps/web") ? cwd : resolve(cwd, "apps/web");
  try {
    const source = await readFile(/* turbopackIgnore: true */ resolve(root, process.env.AXIOM_DIST_DIR || ".next", "offline-assets.js"), "utf8");
    return new Response(source, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-cache" } });
  } catch { return new Response("Offline assets are available after a production build.", { status: 503 }); }
}
