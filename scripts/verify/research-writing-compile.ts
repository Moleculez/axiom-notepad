import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { buildLatexProject } from "../../packages/shared/src/latex-export";
import {
  researchWritingSource,
  researchWritingReferences,
} from "../../tests/fixtures/research-writing";
const run = promisify(execFile);
// Only checked-in fictional fixtures. Never compile arbitrary working notes.
await mkdir(resolve("data"), { recursive: true });
const root = await mkdtemp(resolve("data/research-writing-compile-"));
const image = await sharp(
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="160"><rect width="640" height="160" fill="#f7f8f5"/><path d="M24 20V138H610" stroke="#858f94" fill="none"/><path d="M24 124L132 107L248 90L364 76L482 47L610 25" fill="none" stroke="#335a70" stroke-width="4"/></svg>',
  ),
)
  .png()
  .toBuffer();
const asset = {
  id: "10000000-0000-4000-8000-000000000001",
  resourceId: "10000000-0000-4000-8000-000000000002",
  versionId: "10000000-0000-4000-8000-000000000001",
  name: "Fictional-results.png",
  mime: "image/png",
  bytes: image.length,
  sha256: createHash("sha256").update(image).digest("hex"),
  originalPath: "assets/originals/fictional-results.png",
  figurePath: "figures/fictional-results.png",
};
let biber = "biber",
  toolWorkaround: string | undefined;
try {
  await run(biber, ["--version"], { timeout: 60000 });
} catch (error) {
  // Some older macOS lipo versions cannot run PAR's universal launcher. Extract
  // a private thin copy; never replace the installed compiler or system tools.
  if (
    process.platform !== "darwin" ||
    !String((error as { stderr?: string }).stderr).includes("extracting") ||
    !["arm64", "x64"].includes(process.arch)
  )
    throw error;
  biber = join(root, "biber");
  await run("/usr/bin/lipo", [
    "/Library/TeX/texbin/biber",
    "-thin",
    process.arch === "arm64" ? "arm64" : "x86_64",
    "-o",
    biber,
  ]);
  await run(biber, ["--version"], { timeout: 60000 });
  toolWorkaround =
    "Private architecture-specific Biber copy for the macOS universal-launcher/lipo incompatibility";
  console.log(toolWorkaround);
}
for (const backend of ["biber", "bibtex"] as const)
  for (const citations of ["numeric", "author-year"] as const) {
    const directory = join(root, `${backend}-${citations}`);
    await mkdir(directory);
    const project = buildLatexProject(
      {
        source:
          researchWritingSource +
          `\n## Figure inclusion\n\n![Fictional results](/api/v1/attachments/${asset.id})\n\n\`\`\`mermaid\nflowchart LR\n Study --> Result\n\`\`\`\n`,
        title: "Reproducible research",
        generation: 1,
      },
      { backend, citations, toc: true },
      researchWritingReferences,
      [asset],
    );
    assert.equal(
      project.diagnostics.length,
      0,
      JSON.stringify(project.diagnostics),
    );
    for (const [path, body] of Object.entries(project.files)) {
      const target = join(directory, path);
      await mkdir(resolve(target, ".."), { recursive: true });
      await writeFile(target, body);
    }
    // The browser acceptance separately verifies actual Mermaid rendering. This
    // trusted PNG fixture tests generated TeX paths and local figure inclusion.
    for (const path of [
      asset.originalPath,
      asset.figurePath,
      ...project.diagrams.map((d) => d.path),
    ]) {
      const target = join(directory, path);
      await mkdir(resolve(target, ".."), { recursive: true });
      await writeFile(target, image);
    }
    const texArgs = [
      "-no-shell-escape",
      "-halt-on-error",
      "-interaction=nonstopmode",
      "main.tex",
    ];
    await run("xelatex", texArgs, { cwd: directory, timeout: 60000 });
    await run(backend === "biber" ? biber : "bibtex", ["main"], {
      cwd: directory,
      timeout: 60000,
    });
    await run("xelatex", texArgs, { cwd: directory, timeout: 60000 });
    await run("xelatex", texArgs, { cwd: directory, timeout: 60000 });
    const log = await readFile(join(directory, "main.log"), "utf8");
    assert(
      !/undefined references|Citation .*undefined|Missing character|multiply defined|Overfull \\hbox/.test(
        log,
      ),
      "Review compilation diagnostics: " + directory,
    );
    console.log(`Compiled ${backend}/${citations}: ${directory}/main.pdf`);
  }
await writeFile(
  join(root, "receipt.json"),
  JSON.stringify(
    {
      status: "passed",
      profiles: 4,
      toolWorkaround,
      scope:
        "Trusted fictional fixture, XeLaTeX without shell escape; no server compiler or working data",
      finishedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log("Compile evidence: " + root);
