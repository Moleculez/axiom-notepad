import { access, readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

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
  let fence = "";
  const lines = (await readFile(path, "utf8")).split("\n");
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n],
      start = line.trimStart().match(/^(`{3,}|~{3,})/);
    if (start) {
      fence = fence ? "" : start[1][0];
      continue;
    }
    if (fence) continue;
    for (const match of line
      .replace(/`[^`]*`/g, "")
      .matchAll(/\[[^\]]*\]\((<?[^\s)]+>?)(?:\s+"[^"]*")?\)/g)) {
      const target = match[1].replace(/^<|>$/g, "");
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) continue;
      const destination = resolve(
        dirname(path),
        decodeURIComponent(target.split(/[?#]/)[0]),
      );
      const local = relative(root, destination);
      // Historical private reports are intentionally not part of a clean clone.
      if (/^(?:data|test-results|playwright-report)\//.test(local)) {
        privateReferences++;
        continue;
      }
      try {
        await access(destination);
        checked++;
      } catch {
        errors.push(`${relative(root, path)}:${n + 1}: missing ${target}`);
      }
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
    `${files.length} Markdown documents and npm script paths checked: ${checked} local references resolved; ${privateReferences} historical private-artifact links excluded. External URLs and fragment anchors are not validated.`,
  );
