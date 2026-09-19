import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
// Copy licensed, pinned runtime fonts locally. No editor data reaches a CDN.
const source = resolve("node_modules/mathlive"),
  target = resolve("apps/web/public/tool-assets/mathlive");
await mkdir(target, { recursive: true });
await cp(resolve(source, "fonts"), resolve(target, "fonts"), {
  recursive: true,
  force: false,
});
const license = await readFile(resolve(source, "LICENSE.txt"), "utf8").catch(
  () => readFile(resolve(source, "LICENSE"), "utf8"),
);
await writeFile(resolve(target, "LICENSE.txt"), license);
const notices = [
  "Axiom Research Tools - third-party notices",
  "MathLive 0.110.0\n" + license,
];
// Keep PDF text maps, fallback fonts and image decoders on the same origin.
const pdfSource = resolve("node_modules/pdfjs-dist");
const pdfTarget = resolve("apps/web/public/tool-assets/pdfjs");
await mkdir(pdfTarget, { recursive: true });
for (const folder of ["cmaps", "standard_fonts", "wasm"]) {
  await cp(resolve(pdfSource, folder), resolve(pdfTarget, folder), {
    recursive: true,
  });
}
for (const [name, file] of [
  ["ag-psd", "LICENSE"],
  ["exceljs", "LICENSE"],
  ["file-type", "license"],
  ["exifreader", "LICENSE"],
  ["@xmldom/xmldom", "LICENSE"],
  ["pdfjs-dist", "LICENSE"],
]) {
  const pkg = resolve("node_modules", name);
  const metadata = JSON.parse(
    await readFile(resolve(pkg, "package.json"), "utf8"),
  );
  notices.push(
    `${name} ${metadata.version}\n${name === "exifreader" ? `Unmodified source: https://registry.npmjs.org/exifreader/-/exifreader-${metadata.version}.tgz\n` : ""}${await readFile(resolve(pkg, file), "utf8")}`,
  );
}
await writeFile(
  resolve(target, "../THIRD_PARTY_NOTICES.txt"),
  notices.join("\n\n====================\n\n"),
);
console.log(
  "MathLive and PDF.js runtime assets and licenses prepared locally.",
);
