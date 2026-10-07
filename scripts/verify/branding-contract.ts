import ts from "typescript";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { UiDiagnostic } from "./ui-contract";

// Presentation vocabulary only. Technical names, historical IDs, provider
// recipients, standards and upstream notices must not be erased by a brand check.
const borrowedPresentation =
  /\b(?:Typora|Notion|Obsidian|Photoshop|WordPress|ClickUp|Zotero|shadcn|Google (?:Drive|Docs|Sheets|Slides)|Windows Explorer|Material (?:Tonal|Research|Indigo|Sage|Teal|3)|Fluent (?:Studio|UI|2)|macOS Studio|Tufte Essay)\b/gi;
const technicalLiteral =
  /^(?:image\/vnd\.adobe\.photoshop|https?:\/\/\S+|@[^\s]+)$/i;

export function authoredBrandingPath(file: string) {
  return (
    !/(?:^|\/)(?:licenses?|fonts|assets|tool-assets|theme-fixtures)(?:\/|$)/i.test(
      file,
    ) &&
    !/(?:LICENSE|NOTICE|THIRD_PARTY)/i.test(file) &&
    /\.(?:md|tsx?|jsx?)$/.test(file)
  );
}

export function validateAuthoredBranding(
  file: string,
  source: string,
): UiDiagnostic[] {
  if (!authoredBrandingPath(file)) return [];
  const diagnostics: UiDiagnostic[] = [];
  const inspect = (text: string, offset: number) => {
    if (technicalLiteral.test(text.trim())) return;
    borrowedPresentation.lastIndex = 0;
    for (const match of text.matchAll(borrowedPresentation)) {
      diagnostics.push({
        file,
        line: source.slice(0, offset + match.index).split("\n").length,
        message: `Use original Axiom presentation wording instead of “${match[0]}”; retain technical identities and upstream notices.`,
      });
    }
  };
  if (file.endsWith(".md")) inspect(source, 0);
  else {
    const document = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node) => {
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node) ||
        ts.isJsxText(node)
      )
        inspect(node.text, node.getStart(document));
      ts.forEachChild(node, visit);
    };
    visit(document);
  }
  return diagnostics;
}

type PackageMetadata = { name?: unknown; license?: unknown };
export function validateProjectLicensing(
  manifests: Readonly<Record<string, PackageMetadata>>,
  lock: Readonly<Record<string, PackageMetadata>>,
  license: string,
): UiDiagnostic[] {
  const errors: UiDiagnostic[] = [];
  for (const [path, manifest] of Object.entries(manifests)) {
    if (manifest.license !== "MIT")
      errors.push({
        file: path || "package.json",
        line: 1,
        message: "First-party package license must be MIT.",
      });
    const entry =
      path === "package.json" ? "" : path.replace(/\/package\.json$/, "");
    if (lock[entry]?.name !== manifest.name || lock[entry]?.license !== "MIT")
      errors.push({
        file: "package-lock.json",
        line: 1,
        message: `First-party license metadata must match ${path}.`,
      });
  }
  if (
    !license.startsWith("MIT License\n\nCopyright (c) 2026 Moleculez\n") ||
    !license.includes(
      "The above copyright notice and this permission notice",
    ) ||
    !license.includes('THE SOFTWARE IS PROVIDED "AS IS"')
  )
    errors.push({
      file: "LICENSE",
      line: 1,
      message:
        "Root MIT license must retain the selected copyright, permission notice and disclaimer.",
    });
  return errors;
}

export async function inspectBrandingAndLicensing(root = process.cwd()) {
  let checked = 0;
  const errors: UiDiagnostic[] = [];
  const inspectFile = async (file: string) => {
    if (!authoredBrandingPath(file)) return;
    checked++;
    errors.push(
      ...validateAuthoredBranding(
        file,
        await readFile(join(root, file), "utf8"),
      ),
    );
  };
  const walk = async (directory: string) => {
    for (const entry of await readdir(join(root, directory), {
      withFileTypes: true,
    })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (
          !/(?:^\.|^(?:node_modules|dist|public|assets|tool-assets|fonts|licenses|theme-fixtures)$)/.test(
            entry.name,
          )
        )
          await walk(file);
      } else if (entry.isFile()) await inspectFile(file);
    }
  };
  await inspectFile("README.md");
  await inspectFile("CONTRIBUTING.md");
  for (const directory of ["apps", "packages", "docs"]) await walk(directory);
  const manifests: Record<string, PackageMetadata> = {
    "package.json": JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    ),
  };
  for (const directory of ["apps", "packages"]) {
    for (const entry of await readdir(join(root, directory), {
      withFileTypes: true,
    })) {
      if (entry.isDirectory()) {
        const file = join(directory, entry.name, "package.json");
        manifests[file] = JSON.parse(await readFile(join(root, file), "utf8"));
      }
    }
  }
  const lock = JSON.parse(
    await readFile(join(root, "package-lock.json"), "utf8"),
  );
  errors.push(
    ...validateProjectLicensing(
      manifests,
      lock.packages,
      await readFile(join(root, "LICENSE"), "utf8"),
    ),
  );
  return { errors, checked, packagesChecked: Object.keys(manifests).length };
}
