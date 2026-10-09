import { describe, expect, it } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import JSZip from "jszip";
import { parseMarkdown, renderDocument } from "@axiom/markdown";
import {
  importPath,
  importExclusion,
  validateImportManifest,
  planImport,
  decodeImportMarkdown,
  canonicalImportJson,
  retainImportReceipt,
  type WorkspaceImportBatch,
  type ImportManifestEntry,
} from "../packages/shared/src/workspace-import";
import {
  rewriteImportLinks,
  rewriteMarkdownDestinations,
} from "../packages/shared/src/workspace-import-links";
import {
  inspectImportZip,
  importCrc32,
} from "../packages/shared/src/workspace-import-zip";
const hash = createHash("sha256").update("").digest("hex");
const entry = (
  path: string,
  kind: ImportManifestEntry["kind"] = "note",
): ImportManifestEntry => ({
  id: randomUUID(),
  path,
  kind,
  bytes: kind === "folder" ? 0 : 12,
  digest: kind === "folder" ? null : hash,
});
const noteId = randomUUID(),
  fileId = randomUUID();
const targets = new Map([
  ["lab/other.md", { kind: "note" as const, id: noteId }],
  ["lab/data/plot.png", { kind: "file" as const, id: fileId }],
]);
describe("workspace import inventory and conflict policy", () => {
  it("retains terminal server receipts when older background reads arrive", () => {
    const current = {
      id: randomUUID(),
      status: "complete",
      result: { resources: [], warnings: [] },
    } as unknown as WorkspaceImportBatch;
    expect(
      retainImportReceipt(current, {
        ...current,
        status: "preparing",
        result: null,
      }),
    ).toBe(current);
    expect(
      retainImportReceipt(
        { ...current, status: "cancelled" },
        { ...current, status: "publishing" },
      ).status,
    ).toBe("cancelled");
    expect(retainImportReceipt(undefined, current)).toBe(current);
    expect(
      retainImportReceipt({ ...current, status: "preparing" }, current),
    ).toBe(current);
  });
  it("keeps request and preview identities stable across JSONB key reordering", () => {
    expect(
      canonicalImportJson({
        source: "folder",
        entries: [{ path: "α.md", bytes: 0, id: "id" }],
      }),
    ).toBe(
      canonicalImportJson({
        entries: [{ id: "id", bytes: 0, path: "α.md" }],
        source: "folder",
      }),
    );
  });
  it.each([
    "../secrets.md",
    "/root/a.md",
    "C:/a.md",
    "a\\b.md",
    "a/../b.md",
    "a//b.md",
    "a/ b.md",
    "a/\0b",
    "a/.",
  ])("rejects unsafe path %s", (path) =>
    expect(() => importPath(path)).toThrow(),
  );
  it("normalizes Unicode and rejects case/normalization ambiguity", () => {
    expect(importPath("Cafe\u0301.md")).toBe("Café.md");
    expect(() =>
      validateImportManifest({
        source: "markdown",
        entries: [entry("Café.md"), entry("CAFE\u0301.md")],
      }),
    ).toThrow(/ambiguous/);
  });
  it("excludes likely secrets but keeps ordinary research dotfiles", () => {
    for (const name of [
      ".env",
      "Lab/.env.local",
      "node_modules/pkg/a.md",
      "credentials",
      "lab/key.pem",
      "__MACOSX/foo",
    ])
      expect(importExclusion(name)).toBeTruthy();
    expect(importExclusion("lab/.obsidian/appearance.json")).toBeNull();
  });
  it("permits empty notes, requires complete parents and note classification", () => {
    expect(
      validateImportManifest({
        source: "markdown",
        entries: [{ ...entry("empty.md"), bytes: 0 }],
      }).entries,
    ).toHaveLength(1);
    expect(() =>
      validateImportManifest({
        source: "folder",
        entries: [entry("Lab/a.md")],
      }),
    ).toThrow(/parent/);
    expect(() =>
      validateImportManifest({
        source: "folder",
        entries: [entry("a.md", "file")],
      }),
    ).toThrow(/native note/);
    expect(() =>
      validateImportManifest({
        source: "markdown",
        entries: [entry("a.png", "file")],
      }),
    ).toThrow(/Markdown files/);
  });
  it("plans 2,000 names using indexed siblings and rejects a 2,001-entry collection", () => {
    const entries = Array.from({ length: 2000 }, (_, index) =>
      entry(`Paper ${index}.md`),
    );
    const manifest = validateImportManifest({ source: "markdown", entries });
    const existing = entries.map((e) => ({
      id: randomUUID(),
      parent_id: null,
      name: e.path.slice(0, -3),
      kind: "note",
      version: 1,
    }));
    const plan = planImport(manifest, existing);
    expect(plan).toHaveLength(2000);
    expect(new Set(plan.map((e) => e.name)).size).toBe(2000);
    expect(plan.every((e) => e.name.endsWith(" (2)"))).toBe(true);
    expect(() =>
      validateImportManifest({
        source: "markdown",
        entries: [...entries, entry("Too many.md")],
      }),
    ).toThrow();
  });
  it("accepts exactly 32 folder levels and rejects longer names and deeper folders", () => {
    const folders = Array.from({ length: 32 }, (_, index) =>
      entry(
        Array.from({ length: index + 1 }, (_, n) => `Level${n}`).join("/"),
        "folder",
      ),
    );
    const path = folders.at(-1)!.path;
    expect(
      validateImportManifest({
        source: "folder",
        entries: [...folders, entry(path + "/Paper.md")],
      }).entries,
    ).toHaveLength(33);
    expect(() =>
      validateImportManifest({
        source: "folder",
        entries: [...folders, entry(path + "/TooDeep", "folder")],
      }),
    ).toThrow(/32 folder/);
    expect(() => importPath("x".repeat(201))).toThrow();
  });
  it("keeps both without overwriting and merges only unambiguous folders", () => {
    const folder = entry("Lab", "folder"),
      note = entry("Lab/paper.md"),
      image = entry("Lab/data.png", "file"),
      existingFolder = randomUUID();
    const manifest = validateImportManifest({
      source: "folder",
      conflict: "merge",
      entries: [folder, note, image],
    });
    const existing = [
      {
        id: existingFolder,
        parent_id: null,
        name: "Lab",
        kind: "folder",
        version: 1,
      },
      {
        id: randomUUID(),
        parent_id: existingFolder,
        name: "paper",
        kind: "note",
        version: 1,
      },
      {
        id: randomUUID(),
        parent_id: existingFolder,
        name: "data.png",
        kind: "file",
        version: 1,
      },
    ];
    const plan = planImport(manifest, existing);
    expect(plan[0]).toMatchObject({
      disposition: "merge",
      resourceId: existingFolder,
    });
    expect(plan.find((e) => e.kind === "note")).toMatchObject({
      name: "paper (2)",
      parentId: existingFolder,
    });
    expect(plan.find((e) => e.kind === "file")).toMatchObject({
      name: "data (2).png",
    });
    expect(
      planImport({ ...manifest, conflict: "skip" }, existing).every(
        (e) => e.disposition === "skip",
      ),
    ).toBe(true);
    expect(
      planImport({ ...manifest, conflict: "keepBoth" }, existing)[0].name,
    ).toBe("Lab (2)");
  });
  it("strict UTF-8 preserves BOM/CRLF/empty contents and enforces limits", () => {
    expect(decodeImportMarkdown(new Uint8Array())).toBe("");
    expect(
      decodeImportMarkdown(
        new TextEncoder().encode("\ufeff# Research\r\n\r\n$E$"),
      ),
    ).toBe("\ufeff# Research\r\n\r\n$E$");
    expect(() => decodeImportMarkdown(new Uint8Array([0xff]))).toThrow(/UTF-8/);
    expect(() => decodeImportMarkdown(new Uint8Array([0]))).toThrow(/binary/);
    expect(() =>
      decodeImportMarkdown(new TextEncoder().encode("a".repeat(1_000_001))),
    ).toThrow(/1,000,000/);
  });
});
describe("source-preserving local links", () => {
  it("retains bare wiki-link file names and fragments rather than displaying assigned UUIDs", () => {
    const source =
      "\ufeff# Research\r\n\r\n[[Other]] [[Other.md#Methods]] [[Other.md|My label]] [[Other.md|]]\r\n\r\n`[[Other]]`\r\n";
    const result = rewriteImportLinks(source, "Lab/main.md", targets);
    expect(result.body).toBe(
      `\ufeff# Research\r\n\r\n[[${noteId}|Other]] [[${noteId}#Methods|Other.md#Methods]] [[${noteId}|My label]] [[${noteId}|]]\r\n\r\n\`[[Other]]\`\r\n`,
    );
    expect(result.warnings).toEqual([]);
    const html = renderDocument(parseMarkdown(result.body), {
      resolveLink: (target) => ({
        href: `/workbench/notes/${target}`,
        title: "Other",
      }),
    });
    expect(html).toContain(
      `data-note-target="${noteId}" title="Linked note: Other">Other</a>`,
    );
    expect(html).toContain(
      `data-note-target="${noteId}#Methods" title="Linked note: Other">Other.md#Methods</a>`,
    );
  });
  it("preserves wiki labels in nested quotes, lists, footnotes and duplicate source spans", () => {
    const source =
      "> - [[Other]]\r\n>   - [[Other.md#Intro]]\r\n\r\nText[^n]\r\n\r\n[^n]: See [[Other]].\r\n";
    const result = rewriteImportLinks(source, "Lab/main.md", targets);
    expect(result.body).toBe(
      source
        .replaceAll("[[Other]]", `[[${noteId}|Other]]`)
        .replace("[[Other.md#Intro]]", `[[${noteId}#Intro|Other.md#Intro]]`),
    );
    expect(rewriteImportLinks(result.body, "Lab/main.md", targets).body).toBe(
      result.body,
    );
  });
  it("escapes new table aliases and retains existing alias separators without changing columns", () => {
    const source =
      "| Bare note | Aliased note |\r\n| --- | --- |\r\n| [[Other]] | [[Other.md\\|My label]] |\r\n";
    const result = rewriteImportLinks(source, "Lab/main.md", targets);
    expect(result.body).toBe(
      `| Bare note | Aliased note |\r\n| --- | --- |\r\n| [[${noteId}\\|Other]] | [[${noteId}\\|My label]] |\r\n`,
    );
    const parsed = parseMarkdown(result.body),
      table = parsed.ast.children![0];
    expect(table.type).toBe("table");
    expect(table.children!.map((row) => row.children!.length)).toEqual([2, 2]);
    expect(parsed.links).toMatchObject([
      { target: noteId, label: "Other" },
      { target: noteId, label: "My label" },
    ]);
    expect(rewriteImportLinks(result.body, "Lab/main.md", targets).body).toBe(
      result.body,
    );
    const exported = rewriteMarkdownDestinations(result.body, () => "Other.md");
    expect(exported).toBe(source.replace("[[Other]]", "[[Other.md\\|Other]]"));
  });
  it("keeps Unicode labels, explicit aliases and unresolved targets unchanged", () => {
    const unicodeId = randomUUID(),
      local = new Map(targets);
    local.set("lab/研究.md", { kind: "note", id: unicodeId });
    const source = "[[研究.md]] [[研究.md|My | label]] [[Missing note]]";
    const result = rewriteImportLinks(source, "Lab/main.md", local);
    expect(result.body).toBe(
      `[[${unicodeId}|研究.md]] [[${unicodeId}|My | label]] [[Missing note]]`,
    );
    expect(result.warnings).toEqual([
      "Unresolved link in Lab/main.md: Missing note",
    ]);
  });
  it("keeps remapped collection identities implicit and leaves export destination policy independent", () => {
    const original = randomUUID(),
      source = `[[${original}#Intro]] [[${original}|Authored alias]]`;
    const imported = rewriteImportLinks(
      source,
      "Lab/main.md",
      targets,
      new Map([["resource:" + original, { kind: "note", id: noteId }]]),
    );
    expect(imported.body).toBe(source.replaceAll(original, noteId));
    expect(imported.warnings).toEqual([]);
    expect(rewriteMarkdownDestinations(`[[${noteId}]]`, () => "Other.md")).toBe(
      "[[Other.md]]",
    );
  });
  it("patches inline destinations, images, wiki aliases, definitions and footnotes, not code or titles", () => {
    const source =
      '# Research\r\n\r\n[**Other**](<Other.md#Methods> "unchanged title") ![plot](data/plot.png)\r\n\r\n[[Other.md#Methods|Named alias]]\r\n\r\n[reference][r]\r\n\r\n[r]:\r\n  <Other.md#Results> "reference title"\r\n\r\nFootnote[^n].\r\n\r\n[^n]: [other](Other.md#Methods)\r\n\r\n```md\r\n[example](Other.md)\r\n```\r\n';
    const expected = source
      .replace("<Other.md#Methods>", `<${noteId}#Methods>`)
      .replace("(data/plot.png)", `(/api/v1/attachments/${fileId})`)
      .replace("[[Other.md#Methods|", `[[${noteId}#Methods|`)
      .replace("<Other.md#Results>", `<${noteId}#Results>`)
      .replace(
        "[^n]: [other](Other.md#Methods)",
        `[^n]: [other](${noteId}#Methods)`,
      );
    const result = rewriteImportLinks(source, "Lab/main.md", targets);
    expect(result.body).toBe(expected);
    expect(result.warnings).toEqual([]);
  });
  it("preserves missing, escaping, external and ambiguous targets", () => {
    const source =
      "[missing](no.md) [external](https://example.org) [escape](../../secret.md) [ambiguous](Other) `![code](data/plot.png)`";
    const ambiguous = new Map(targets);
    ambiguous.set("lab/other.markdown", { kind: "note", id: randomUUID() });
    const result = rewriteImportLinks(source, "Lab/main.md", ambiguous);
    expect(result.body).toBe(source);
    expect(result.warnings).toHaveLength(2);
  });
  it("maps destinations through nested list/quote/footnote source offsets", () => {
    const source =
      "> - [quoted](Other.md#Intro)\r\n>   - ![image](data/plot.png)\r\n\r\nText[^n]\r\n\r\n[^n]: First\r\n    [child](Other.md)\r\n";
    const result = rewriteImportLinks(source, "Lab/main.md", targets);
    expect(result.body).toBe(
      source
        .replace("Other.md#Intro", `${noteId}#Intro`)
        .replace("data/plot.png", `/api/v1/attachments/${fileId}`)
        .replace("(Other.md)", `(${noteId})`),
    );
  });
  it("preserves a leading BOM while parsing its heading and patching destination offsets", () => {
    const source = "\ufeff# Research\r\n\r\n[other](Other.md#Methods)\r\n";
    expect(parseMarkdown(source).outline[0]).toMatchObject({
      text: "Research",
      from: 1,
    });
    expect(rewriteImportLinks(source, "Lab/Main.md", targets).body).toBe(
      source.replace("Other.md#Methods", `${noteId}#Methods`),
    );
  });
  it("uses host-owned UUID navigation in Read mode without flattening styled labels", () => {
    const html = renderDocument(parseMarkdown(`[**Other**](${noteId}#Intro)`), {
      resolveLink: () => ({
        href: `/workbench/notes/${noteId}#Intro`,
        title: "Other",
      }),
    });
    expect(html).toContain(`data-note-target="${noteId}#Intro"`);
    expect(html).toContain("<strong>Other</strong>");
  });
});
describe("ZIP preflight", () => {
  it("accepts UTF-8 archives with empty folders and matching CRC", async () => {
    const zip = new JSZip();
    zip.folder("Lab/Empty");
    zip.file("Lab/α.md", "# α");
    const bytes = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
    });
    const entries = inspectImportZip(bytes);
    expect(entries.find((e) => e.path === "Lab/α.md")).toMatchObject({
      bytes: 4,
      directory: false,
    });
    expect(entries.find((e) => e.path === "Lab/Empty")).toMatchObject({
      directory: true,
    });
    const text = new TextEncoder().encode("# α");
    expect(importCrc32(text)).toBe(
      entries.find((e) => e.path === "Lab/α.md")!.crc,
    );
    expect(
      importCrc32(text.subarray(2), importCrc32(text.subarray(0, 2))),
    ).toBe(importCrc32(text));
  });
  it("rejects original traversal paths before JSZip sanitization", async () => {
    const zip = new JSZip();
    zip.file("../escape.md", "test", { createFolders: false });
    expect(() => inspectImportZip(new Uint8Array())).toThrow(/malformed/);
    expect(() => inspectImportZip(new Uint8Array([1, 2, 3]))).toThrow();
    const bytes = await zip.generateAsync({ type: "uint8array" });
    expect(() => inspectImportZip(bytes)).toThrow(/relative paths/);
  });
  it("rejects symlinks, ambiguous names, encryption and oversized expansion", async () => {
    const link = new JSZip();
    link.file("link.md", "../target", { unixPermissions: 0xa1ff });
    const linkBytes = await link.generateAsync({
      type: "uint8array",
      platform: "UNIX",
    });
    expect(() => inspectImportZip(linkBytes)).toThrow(/links/);
    const duplicate = new JSZip();
    duplicate.file("a.md", "a");
    duplicate.file("A.md", "b");
    const bytes = await duplicate.generateAsync({ type: "uint8array" });
    expect(() => inspectImportZip(bytes)).toThrow(/ambiguous/);
    const one = new JSZip();
    one.file("a.md", "test");
    const encrypted = await one.generateAsync({ type: "uint8array" });
    const central = encrypted.findIndex(
      (b, i) =>
        b === 0x50 &&
        encrypted[i + 1] === 0x4b &&
        encrypted[i + 2] === 1 &&
        encrypted[i + 3] === 2,
    );
    new DataView(encrypted.buffer).setUint16(central + 8, 1, true);
    expect(() => inspectImportZip(encrypted)).toThrow(/Encrypted/);
    const large = await one.generateAsync({ type: "uint8array" });
    new DataView(large.buffer).setUint32(central + 24, 100_000_001, true);
    expect(() => inspectImportZip(large)).toThrow(/expansion/);
  });
});
