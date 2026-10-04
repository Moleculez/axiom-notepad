import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { makePluginPackage } from "../../packages/shared/src/plugin-package";
import { pluginManifestSchema } from "../../packages/shared/src/plugins";

/** Compile only: package code is never imported or executed by this command. */
export async function packPlugin(
  manifestPath: string,
  entryPath: string,
  outputPath: string,
  force = false,
) {
  const manifest = pluginManifestSchema.parse(
    JSON.parse(await readFile(resolve(manifestPath), "utf8")),
  );
  const result = await build({
    entryPoints: [resolve(entryPath)],
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
    target: "es2022",
    sourcemap: false,
    legalComments: "inline",
    logLevel: "silent",
    tsconfig: resolve("tsconfig.json"),
  });
  if (result.outputFiles.length !== 1)
    throw new Error(
      "API v1 requires one self-contained JavaScript bundle; no CSS or asset files.",
    );
  const p = await makePluginPackage(manifest, result.outputFiles[0].text);
  const output = resolve(outputPath);
  if (!output.endsWith(".zip")) throw new Error("Choose a .zip output file.");
  if ([resolve(manifestPath), resolve(entryPath)].includes(output))
    throw new Error("The output must not replace an input.");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, p.archive, { flag: force ? "w" : "wx" });
  return {
    output,
    hash: p.hash,
    bytes: p.archive.length,
    manifest: p.manifest,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [manifest, entry, output, option] = process.argv.slice(2);
  if (
    !manifest ||
    !entry ||
    !output ||
    (option && option !== "--force") ||
    process.argv.length > 6
  )
    throw new Error(
      "Usage: npm run plugin:pack -- manifest.json index.ts output.zip [--force]",
    );
  const p = await packPlugin(manifest, entry, output, option === "--force");
  console.log(
    `${p.manifest.name} ${p.manifest.version} · ${p.bytes} bytes\nSHA-256 ${p.hash}\n${p.output}\nCompiled and validated, not executed or installed.`,
  );
}
