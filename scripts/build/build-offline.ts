import "dotenv/config";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const output = join("apps/web", process.env.AXIOM_DIST_DIR || ".next");
const directory = join(output, "static");
async function assets(
  dir: string,
  relative = "",
  prefix = "/_next/static/",
): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }),
    paths: string[] = [];
  for (const entry of entries) {
    // Finder metadata and hidden tooling files are not public application assets.
    // One failing URL would reject Cache.addAll and prevent the shell installing.
    if (entry.name.startsWith(".")) continue;
    const name = relative + entry.name;
    if (entry.isDirectory())
      paths.push(...(await assets(join(dir, entry.name), name + "/", prefix)));
    else if (!name.endsWith(".map")) paths.push(prefix + name);
  }
  return paths;
}
const buildId = (await readFile(join(output, "BUILD_ID"), "utf8")).trim();
const files = [
  ...(await assets(directory)),
  ...(await assets("apps/web/public/tool-assets", "", "/tool-assets/")),
  "/icons/192.png",
  "/icons/512.png",
];
await writeFile(
  join(output, "offline-assets.js"),
  `self.AXIOM_BUILD_ID=${JSON.stringify(buildId)};self.AXIOM_ASSETS=${JSON.stringify(files)};\n`,
);
// The legacy public manifest is only changed by a default release build.
if (!process.env.AXIOM_DIST_DIR)
  await writeFile(
    "apps/web/public/offline-assets.js",
    `self.AXIOM_BUILD_ID=${JSON.stringify(buildId)};self.AXIOM_ASSETS=${JSON.stringify(files)};\n`,
  );
console.log(`Prepared ${files.length} build assets for offline use.`);
