import { access, readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { documentationLinks } from "./doc-links";

const root = process.cwd();
async function markdown(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isDirectory() && item.name !== "theme-fixtures")
      files.push(...(await markdown(path)));
    else if (item.isFile() && item.name.endsWith(".md")) files.push(path);
  }
  return files;
}
const files = ["README.md", "CONTRIBUTING.md", "IMPLEMENTATION.md"].map((p) =>
  resolve(root, p),
);
files.push(...(await markdown(resolve(root, "docs"))));
const errors: string[] = [];
let checked = 0,
  privateReferences = 0;
for (const path of files) {
  for (const { target, line } of documentationLinks(
    await readFile(path, "utf8"),
  )) {
    try {
      const decoded = decodeURIComponent(target.split(/[?#]/)[0]);
      const destination = resolve(
        decoded.startsWith("/") ? root : dirname(path),
        decoded.replace(/^\/+/, ""),
      );
      const local = relative(root, destination);
      if (local === ".." || local.startsWith("../")) {
        errors.push(
          `${relative(root, path)}:${line}: outside repository: ${target}`,
        );
        continue;
      }
      // Historical private reports are intentionally not part of a clean clone.
      if (/^(?:data|test-results|playwright-report)\//.test(local)) {
        privateReferences++;
        continue;
      }
      await access(destination);
      checked++;
    } catch {
      errors.push(
        `${relative(root, path)}:${line}: missing or invalid ${target}`,
      );
    }
  }
}
const pkg = JSON.parse(await readFile("package.json", "utf8"));
for (const [name, command] of Object.entries(
  pkg.scripts as Record<string, string>,
))
  for (const [path] of command.matchAll(/scripts\/[\w/-]+\.(?:ts|sh)/g))
    try {
      await access(path);
      checked++;
    } catch {
      errors.push(`package.json scripts.${name}: missing ${path}`);
    }
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `${files.length} Markdown documents, HTML image/picture assets and npm script paths checked: ${checked} local references resolved; ${privateReferences} historical private-artifact links excluded. External URLs and fragment anchors are not validated.`,
  );
