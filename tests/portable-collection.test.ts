import { describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import {
  portableCollectionFixture,
  portableCollectionZip,
} from "./fixtures/portable-collection";
import {
  portableCollectionSchema,
  portableMetadataSchema,
  collectionLinkPath,
} from "../packages/shared/src/portable-collection";
import {
  inspectCollectionFiles,
  collectionFileSha256,
} from "../apps/web/lib/collection-inventory";
import { prepareImportInventory } from "../apps/web/lib/workspace-import-inventory";
import { rewriteImportedCanvas } from "../packages/shared/src/canvas-import";
import { parseCanvas } from "../packages/shared/src/canvas";
import {
  rewriteImportLinks,
  rewriteMarkdownDestinations,
  type ImportLinkTarget,
} from "../packages/shared/src/workspace-import-links";
import { validateImportedImageProject } from "../packages/shared/src/image-project-import";
import JSZip from "jszip";

const localFile = (path: string, bytes: Uint8Array | string) => ({
  path,
  file: new File(
    [typeof bytes === "string" ? bytes : new Uint8Array(bytes)],
    path.split("/").at(-1)!,
  ),
});
describe("portable collection contracts", () => {
  it("accepts mixed native sources but never imports authority, UI themes or executable settings", async () => {
    const { manifest } = await portableCollectionFixture();
    expect(portableCollectionSchema.parse(manifest).resources).toHaveLength(9);
    for (const unsafe of [
      { ...manifest, permissions: [] },
      { ...manifest, version: 2 },
      { ...manifest, scope: "workspace-backup" },
    ])
      expect(portableCollectionSchema.safeParse(unsafe).success).toBe(false);
    for (const metadata of [
      { toolKind: "math", settings: { theme: "dark" } },
      { toolKind: "canvas", settings: { script: "no" } },
      { name: "../private" },
      { name: "." },
    ])
      expect(portableMetadataSchema.safeParse(metadata).success).toBe(false);
  });
  it("rejects duplicate identities, case-ambiguous paths, missing primaries and invalid parents", async () => {
    const { manifest } = await portableCollectionFixture();
    const mutations = [
      (value: typeof manifest) => value.resources.push(value.resources[1]),
      (value: typeof manifest) => {
        value.resources[2].path = value.resources[1].path.toUpperCase();
      },
      (value: typeof manifest) => {
        value.artifacts.pop();
      },
      (value: typeof manifest) => {
        value.resources[0].parentId = value.resources[1].id;
      },
      (value: typeof manifest) => {
        value.resources[0].parentId = randomUUID();
      },
      (value: typeof manifest) => {
        value.artifacts[0].role = "asset";
      },
      (value: typeof manifest) => {
        value.artifacts[0].resourceId = randomUUID();
      },
      (value: typeof manifest) => {
        value.artifacts[0].path = "../escape";
      },
      (value: typeof manifest) => {
        value.artifacts[0].path = ".env";
      },
      (value: typeof manifest) => {
        const assets = value.artifacts.filter((item) => item.role === "asset");
        assets[0].versionId = assets[1].versionId = randomUUID();
      },
    ];
    for (const mutate of mutations) {
      const value = structuredClone(manifest);
      mutate(value);
      expect(() => portableCollectionSchema.parse(value)).toThrow();
    }
  });
  it("enforces the total expanded budget as well as per-entry sizes", async () => {
    const { manifest } = await portableCollectionFixture();
    const value = structuredClone(manifest);
    value.artifacts[0].bytes = 100_000_000;
    expect(portableCollectionSchema.safeParse(value).success).toBe(false);
  });
  it("hashes all bytes across transfer chunks without using the digest-of-digests", async () => {
    const bytes = Buffer.alloc(8 * 1024 * 1024 + 57, 0x61);
    expect(await collectionFileSha256(new Blob([bytes]))).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(await collectionFileSha256(new Blob([]))).toBe(
      createHash("sha256").update("").digest("hex"),
    );
  });
  it("imports a real ZIP with all native formats, exact Canvas originals and stable reselection paths", async () => {
    const { bytes, ids, files } = await portableCollectionZip();
    const input = {
      source: "zip" as const,
      files: [localFile("Collection.zip", bytes)],
    };
    const result = await prepareImportInventory(input),
      again = await prepareImportInventory(input);
    expect(
      result.entries
        .filter((e) => e.kind === "note")
        .map((e) => e.sourceFormat)
        .sort(),
    ).toEqual(["canvas", "latex", "markdown", "markdown", "text"]);
    expect(
      result.entries.find((e) => e.metadata?.originId === ids.folder)?.metadata
        ?.name,
    ).toBe("Research collection");
    expect(
      result.entries.find((e) => e.metadata?.originId === ids.raw),
    ).toMatchObject({ kind: "file", asAttachment: true });
    expect(
      result.entries.find((e) => e.metadata?.originId === ids.image)?.metadata
        ?.toolKind,
    ).toBe("image");
    const paper = result.entries.find(
      (e) => e.metadata?.originId === ids.paper,
    )!;
    expect(result.previews[paper.path]).toBe(
      Buffer.from(files.get("Lab/Paper.md")!).toString(),
    );
    const original = result.files.find((f) =>
      /(?:^|\/)\_originals\//.test(f.path),
    )!;
    expect(original).toBeTruthy();
    expect(Buffer.from(await original.file.arrayBuffer())).toEqual(
      Buffer.from(files.get("Lab/Board.canvas")!),
    );
    expect(
      again.files.find((f) => /(?:^|\/)\_originals\//.test(f.path))?.path,
    ).toBe(original.path);
    expect(
      result.entries.every((e) => !Object.values(ids).includes(e.id)),
    ).toBe(true);
  });
  it("verifies checksums before creating a plan and excludes undeclared artifacts", async () => {
    const fixture = await portableCollectionFixture();
    const files = [...fixture.files].map(([path, bytes]) =>
      localFile(path, bytes),
    );
    files.push(
      localFile("axiom-manifest.json", JSON.stringify(fixture.manifest)),
      localFile("unlisted.txt", "not declared"),
    );
    const inspection = await inspectCollectionFiles(files);
    expect(inspection.ignored.has("unlisted.txt")).toBe(true);
    expect(
      inspection.diagnostics.some((d) => d.code === "undeclared-artifact"),
    ).toBe(true);
    files[0] = localFile(files[0].path, "Changed");
    await expect(inspectCollectionFiles(files)).rejects.toThrow(
      /checksum or size mismatch/,
    );
  });
  it("requires an explicit attachment or skip decision for malformed Canvas projects", async () => {
    const input = {
      source: "folder" as const,
      files: [localFile("Lab/Broken.canvas", "not JSON")],
    };
    const unresolved = await prepareImportInventory(input);
    expect(unresolved.diagnostics.some((d) => d.severity === "error")).toBe(
      true,
    );
    const attachment = await prepareImportInventory({
      ...input,
      decisions: { "Lab/Broken.canvas": "attachment" },
    });
    expect(attachment.diagnostics.some((d) => d.severity === "error")).toBe(
      false,
    );
    expect(
      attachment.entries.find((e) => e.path.endsWith("Broken.canvas")),
    ).toMatchObject({ kind: "file", asAttachment: true });
    const skipped = await prepareImportInventory({
      ...input,
      directories: ["Lab"],
      decisions: { "Lab/Broken.canvas": "skip" },
    });
    expect(skipped.entries.some((e) => e.path.endsWith("Broken.canvas"))).toBe(
      false,
    );
  });
  it("bounds verbose collection previews without hiding blocking conversion choices", async () => {
    const { manifest, files } = await portableCollectionFixture();
    const broken = new TextEncoder().encode("not JSON");
    files.set("Lab/Board.canvas", broken);
    const canvas = manifest.artifacts.find(
      (item) => item.path === "Lab/Board.canvas",
    )!;
    canvas.bytes = broken.length;
    canvas.sha256 = createHash("sha256").update(broken).digest("hex");
    manifest.diagnostics = Array.from({ length: 2000 }, () => ({
      severity: "warning" as const,
      code: "archive-advisory",
      message: "Source advisory retained from an exported collection.",
    }));
    const input = {
      source: "folder" as const,
      files: [
        ...[...files].map(([path, bytes]) => localFile(path, bytes)),
        localFile("axiom-manifest.json", JSON.stringify(manifest)),
      ],
    };
    const unresolved = await prepareImportInventory(input);
    expect(unresolved.diagnostics).toHaveLength(2000);
    expect(unresolved.diagnostics[0]).toMatchObject({
      severity: "error",
      code: "conversion-choice",
      path: "Lab/Board.canvas",
    });
    expect(unresolved.diagnostics.at(-1)?.code).toBe("diagnostic-summary");
    const attached = await prepareImportInventory({
      ...input,
      decisions: { "Lab/Board.canvas": "attachment" },
    });
    expect(attached.diagnostics.some((item) => item.severity === "error")).toBe(
      false,
    );
  });
  it("reports unsupported Canvas data, remaps nodes/edges and only binds included resources", async () => {
    const { files, ids } = await portableCollectionFixture();
    const newPaper = randomUUID(),
      newPlot = randomUUID();
    const targets = new Map<string, ImportLinkTarget>([
      ["lab/paper.md", { kind: "note", id: newPaper }],
      ["lab/plot #50%.png", { kind: "file", id: newPlot }],
    ]);
    const origins = new Map<string, ImportLinkTarget>([
      ["version:" + ids.version, { kind: "file", id: newPlot }],
    ]);
    const result = rewriteImportedCanvas(
      Buffer.from(files.get("Lab/Board.canvas")!).toString(),
      "Lab/Board.canvas",
      targets,
      origins,
      randomUUID,
    );
    const canvas = parseCanvas(result.body);
    expect(canvas.nodes[0]).toMatchObject({
      type: "text",
      heightMode: "manual",
      text: `[Paper](${newPaper})`,
    });
    expect(canvas.nodes[1]).toMatchObject({
      resourceId: newPlot,
      versionId: newPlot,
    });
    expect(canvas.edges[0].fromNode).toBe(canvas.nodes[0].id);
    expect(canvas.edges[0].toNode).toBe(canvas.nodes[1].id);
    expect(result.warnings.join(" ")).toMatch(/Unsupported Canvas/);
    expect(result.body).not.toContain("vendorData");
    const missing = parseCanvas(
      rewriteImportedCanvas(
        Buffer.from(files.get("Lab/Board.canvas")!).toString(),
        "Lab/Board.canvas",
        new Map(),
        new Map(),
        randomUUID,
      ).body,
    );
    expect(missing.nodes[1].resourceId).toBeUndefined();
    expect(missing.nodes[1].versionId).toBeUndefined();
  });
  it("preserves syntax, titles, definitions, BOM and CRLF outside destination spans", () => {
    const old = randomUUID(),
      version = randomUUID(),
      source = `\ufeff# Paper\r\n[**link**](<${old}#Theory> "title")\r\n\r\n[figure]: /api/v1/attachments/${version} "kept"\r\n\r\n\`[code](${old})\`\r\n`;
    const path = collectionLinkPath("Lab/Paper.md", "Lab/plot #50%.png");
    expect(path).toBe("plot%20%2350%25.png");
    const exported = rewriteMarkdownDestinations(source, (href) =>
      href.startsWith(old)
        ? "Methods.md#Theory"
        : href.includes(version)
          ? path
          : undefined,
    );
    expect(exported).toBe(
      source
        .replace(`<${old}#Theory>`, "<Methods.md#Theory>")
        .replace(`/api/v1/attachments/${version}`, path),
    );
    const next = randomUUID(),
      target = randomUUID();
    expect(
      rewriteImportLinks(
        exported,
        "Lab/Paper.md",
        new Map([
          ["lab/methods.md", { kind: "note", id: next }],
          ["lab/plot #50%.png", { kind: "file", id: target }],
        ]),
      ).body,
    ).toBe(
      source
        .replace(`<${old}#Theory>`, `<${next}#Theory>`)
        .replace(
          `/api/v1/attachments/${version}`,
          `/api/v1/attachments/${target}`,
        ),
    );
  });
  it("adapts extracted legacy manifests without turning immutable Markdown attachments into notes", async () => {
    const id = randomUUID(),
      version = randomUUID();
    const files = [
      localFile("data/Raw.md", "# Stored attachment"),
      localFile(
        "workspace-manifest.json",
        JSON.stringify({
          format: "axiom-workspace-export",
          version: 1,
          resources: [{ id, kind: "file", path: "Raw.md", name: "Raw.md" }],
          files: [{ resourceId: id, id: version, path: "data/Raw.md" }],
        }),
      ),
    ];
    const result = await prepareImportInventory({ source: "folder", files });
    expect(result.entries.find((e) => e.path === "data/Raw.md")).toMatchObject({
      kind: "file",
      asAttachment: true,
      metadata: { originId: id, originVersionId: version },
    });
    expect(result.diagnostics.some((d) => d.code === "legacy-manifest")).toBe(
      true,
    );
  });
  it("validates declared image projects and rejects hidden assets and broken dimensions", async () => {
    const { files } = await portableCollectionFixture(),
      bytes = files.get("Lab/Picture.axiom-image")!;
    expect((await validateImportedImageProject(bytes)).width).toBe(1);
    const zip = await JSZip.loadAsync(bytes);
    zip.file("hidden.js", "never execute");
    await expect(
      validateImportedImageProject(
        await zip.generateAsync({ type: "uint8array" }),
      ),
    ).rejects.toThrow(/unsafe/);
    zip.remove("hidden.js");
    zip.file(
      "manifest.json",
      JSON.stringify({
        format: "axiom-image",
        version: 1,
        width: 2,
        height: 1,
        layers: [],
      }),
    );
    await expect(
      validateImportedImageProject(
        await zip.generateAsync({ type: "uint8array" }),
      ),
    ).rejects.toThrow(/dimensions/);
  });
});
