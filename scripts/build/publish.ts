import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const target = resolve("apps/publish/dist");
await mkdir(target, { recursive: true });
// Only generated hashed chunks: do not accumulate obsolete bundles across
// builds or copy them into every subsequent immutable publication release.
await rm(resolve(target, "chunks"), { recursive: true, force: true });
await build({
  entryPoints: ["apps/publish/client/reader.ts"],
  outdir: target,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  sourcemap: false,
  legalComments: "linked",
  chunkNames: "chunks/[name]-[hash]",
});
await writeFile(
  resolve(target, "site.css"),
  (
    await Promise.all(
      ["site.css", "experience.css", "highlight.css"].map((file) =>
        readFile(`apps/publish/client/${file}`, "utf8"),
      ),
    )
  ).join("\n") +
    "\n" +
    (await readFile(
      "packages/shared/assets/document-presentation.css",
      "utf8",
    )),
);
await cp(
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  resolve(target, "pdf.worker.min.mjs"),
);
for (const folder of ["cmaps", "standard_fonts", "wasm"])
  await cp(
    resolve("node_modules/pdfjs-dist", folder),
    resolve(target, "pdf", folder),
    { recursive: true },
  );
const notices: string[] = [];
notices.push(await readFile("apps/publish/licenses/LPPL-1.3c.txt", "utf8"));
for (const face of ["regular", "bold", "italic", "bold-italic"])
  await cp(
    resolve("node_modules/latex.css/fonts", `LM-${face}.woff2`),
    resolve(target, `LM-${face}.woff2`),
  );
notices.push(
  `Latin Modern webfonts distributed by latex.css 1.14.0.\n${await readFile("apps/publish/licenses/GUST-FONT-LICENSE.txt", "utf8")}\nLaTeX.css\n${await readFile("node_modules/latex.css/LICENSE", "utf8")}`,
);
for (const [name, font, license] of [
  ["@fontsource/inter", "inter-latin-400-normal.woff2", "LICENSE"],
  ["@fontsource/inter", "inter-latin-600-normal.woff2", "LICENSE"],
  [
    "@fontsource/source-serif-4",
    "source-serif-4-latin-600-normal.woff2",
    "LICENSE",
  ],
  [
    "@fontsource/source-serif-4",
    "source-serif-4-latin-400-italic.woff2",
    "LICENSE",
  ],
  [
    "@fontsource/source-serif-4",
    "source-serif-4-latin-400-normal.woff2",
    "LICENSE",
  ],
] as const) {
  await cp(resolve("node_modules", name, "files", font), resolve(target, font));
  notices.push(
    `${name}\n${await readFile(resolve("node_modules", name, license), "utf8")}`,
  );
}
for (const [name, license] of [
  ["pdfjs-dist", "LICENSE"],
  ["mermaid", "LICENSE"],
])
  notices.push(
    `${name}\n${await readFile(resolve("node_modules", name, license), "utf8")}`,
  );
await writeFile(
  resolve(target, "THIRD_PARTY_NOTICES.txt"),
  notices.join("\n\n"),
);
console.log(
  "Independent publication readers, fonts and notices prepared locally.",
);
