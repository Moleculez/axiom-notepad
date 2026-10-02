import { cp, mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Curated public assets only; never copy the application's public/data roots. */
export async function showcaseAssets(target: string) {
  for (const [from, to] of [
    ["docs/assets/showcase", "gallery"],
    ["docs/assets/brand", "brand"],
    ["node_modules/pdfjs-dist/cmaps", "tool-assets/pdfjs/cmaps"],
    [
      "node_modules/pdfjs-dist/standard_fonts",
      "tool-assets/pdfjs/standard_fonts",
    ],
    ["node_modules/pdfjs-dist/wasm", "tool-assets/pdfjs/wasm"],
    ["node_modules/mathlive/fonts", "tool-assets/mathlive/fonts"],
  ] as const) {
    await mkdir(resolve(target, to), { recursive: true });
    await cp(from, resolve(target, to), { recursive: true });
  }
  await cp(
    "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
    resolve(target, "tool-assets/pdfjs/pdf.worker.min.mjs"),
  );
  const licenses = [
    "packages/shared/assets/latin-modern/LICENSE.txt",
    ...[
      "pdfjs-dist",
      "mermaid",
      "exifreader",
      "@xmldom/xmldom",
      "@fontsource/inter",
      "@fontsource/source-serif-4",
      "@fontsource/source-sans-3",
      "@fontsource/atkinson-hyperlegible",
      "@fontsource/jetbrains-mono",
      "@fontsource/ibm-plex-mono",
    ].map((name) => `node_modules/${name}/LICENSE`),
    "node_modules/mathlive/LICENSE.txt",
  ];
  const notices = await Promise.all(
    licenses.map(async (file) => `${file}\n${await readFile(file, "utf8")}`),
  );
  await writeFile(
    resolve(target, "THIRD_PARTY_NOTICES.txt"),
    notices.join("\n\n"),
  );
}
