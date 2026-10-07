import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  validateUiSource,
  validateUiStyles,
  type UiDiagnostic,
} from "./ui-contract";

const roots = ["apps/web/components", "apps/showcase/src"];
let checked = 0;
let stylesChecked = 0;
const errors: UiDiagnostic[] = [];
async function inspect(directory: string) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await inspect(path);
    else if (entry.isFile() && path.endsWith(".tsx")) {
      checked++;
      errors.push(...validateUiSource(path, await readFile(path, "utf8")));
    } else if (entry.isFile() && path.endsWith(".css")) {
      stylesChecked++;
      errors.push(...validateUiStyles(path, await readFile(path, "utf8")));
    }
  }
}
for (const root of roots) await inspect(root);
await inspect("apps/web/app");
if (errors.length) {
  console.error(
    errors
      .map((error) => `${error.file}:${error.line}: ${error.message}`)
      .join("\n"),
  );
  process.exitCode = 1;
} else
  console.log(
    `${checked} application/showcase JSX files and ${stylesChecked} stylesheets respect the shared UI control contract.`,
  );
