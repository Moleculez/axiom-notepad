import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { PoolClient } from "pg";
import JSZip from "jszip";
const storage = vi.hoisted(() => ({ stream: vi.fn(), free: vi.fn() }));
vi.mock("../packages/shared/src/storage-streams", () => ({
  attachmentStream: storage.stream,
  availableStorageBytes: storage.free,
}));
import { buildPortableCollection } from "../packages/shared/src/portable-collection-worker";
import { inspectImportZip } from "../packages/shared/src/workspace-import-zip";
import { portableCollectionSchema } from "../packages/shared/src/portable-collection";
import { prepareImportInventory } from "../apps/web/lib/workspace-import-inventory";
import { portableCollectionFixture } from "./fixtures/portable-collection";

async function fixture() {
  const value = await portableCollectionFixture(),
    rows = new Map<string, any>(),
    assets = new Map<string, any>();
  for (const resource of value.manifest.resources) {
    const artifact = value.manifest.artifacts.find(
        (a) => a.resourceId === resource.id,
      ),
      version = artifact?.versionId ?? randomUUID();
    rows.set(resource.id, {
      id: resource.id,
      parent_id: resource.parentId,
      kind: resource.kind,
      name: resource.metadata.name,
      description: resource.metadata.description,
      tags: resource.metadata.tags,
      source_format: resource.sourceFormat,
      body:
        resource.kind === "note"
          ? Buffer.from(value.files.get(resource.path)!).toString()
          : undefined,
      generation: 1,
      current_version_id: version,
      tool_kind: resource.metadata.toolKind,
      settings: resource.metadata.settings,
    });
    if (resource.kind === "file") {
      const key = randomUUID(),
        bytes = value.files.get(resource.path)!;
      assets.set(version, {
        id: version,
        resource_id: resource.id,
        storage_key: key,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        name: "Old attachment name",
      });
      storage.stream.mockImplementation(async (requested: string) => {
        const found = [...assets.values()].find(
          (a) => a.storage_key === requested,
        )!;
        const original = value.manifest.resources.find(
          (r) => r.id === found.resource_id,
        )!;
        return Readable.from([Buffer.from(value.files.get(original.path)!)]);
      });
    }
  }
  const db = {
    query: vi.fn(async (sql: string, args: any[]) => {
      if (sql.includes("FROM resources r"))
        return {
          rows: [rows.get(args[0] || assets.get(args[1])?.resource_id)].filter(
            Boolean,
          ),
        };
      if (sql.includes("FROM attachments a"))
        return { rows: [assets.get(args[1])].filter(Boolean) };
      if (sql.includes("axiom_file_references"))
        return {
          rows: [...assets.values()]
            .filter((asset) => String(args[0]).includes(asset.id))
            .map((asset) => ({ id: asset.id })),
        };
      throw new Error("Unexpected fixture SQL: " + sql);
    }),
  } as unknown as PoolClient;
  return { ...value, db, rows, assets };
}
async function output(stream: Readable) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
beforeEach(() => {
  vi.resetAllMocks();
  storage.free.mockResolvedValue(null);
});
describe("streamed reimportable exports", () => {
  it("builds a non-ZIP64 archive that the real browser inventory can reimport", async () => {
    const f = await fixture(),
      record = { user_id: "synthetic-user", resource_ids: [...f.rows.keys()] };
    const result = await buildPortableCollection(f.db, record),
      bytes = await output(result.output);
    expect(inspectImportZip(bytes).length).toBeLessThanOrEqual(1000);
    const zip = await JSZip.loadAsync(bytes, { checkCRC32: true }),
      manifest = portableCollectionSchema.parse(
        JSON.parse(await zip.file("axiom-manifest.json")!.async("string")),
      );
    const paper = manifest.resources.find((r) => r.id === f.ids.paper)!,
      plot = manifest.resources.find((r) => r.id === f.ids.plot)!;
    expect(plot.parentId).toBe(f.ids.folder);
    expect(plot.path.startsWith(manifest.resources[0].path + "/")).toBe(true);
    expect(plot.metadata.name).toBe("plot #50%.png");
    const source = await zip.file(paper.path)!.async("string");
    expect(source.startsWith("\ufeff# Paper\r\n")).toBe(true);
    expect(source).toContain('"unchanged title"');
    const imported = await prepareImportInventory({
      source: "zip",
      files: [
        { path: "Roundtrip.zip", file: new File([bytes], "Roundtrip.zip") },
      ],
    });
    expect(imported.entries.filter((e) => e.kind === "note")).toHaveLength(5);
    expect(
      imported.entries.find((e) => e.metadata?.toolKind === "math")?.metadata
        ?.settings?.fontSize,
    ).toBe(32);
    expect(imported.diagnostics.some((d) => d.severity === "error")).toBe(
      false,
    );
    expect(new Set(result.requiredIds)).toEqual(new Set(f.rows.keys()));
  });
  it("patches only native link destinations, including definitions and escaped filenames", async () => {
    const f = await fixture(),
      paper = f.rows.get(f.ids.paper),
      original = `\ufeff# Paper\r\n\r\n[**Methods**](<${f.ids.methods}#Results> "unchanged")\r\n\r\n[plot]: /api/v1/attachments/${f.ids.version} "kept"\r\n\r\n\`[literal](${f.ids.methods})\`\r\n`;
    paper.body = original;
    const bytes = await output(
        (
          await buildPortableCollection(f.db, {
            user_id: "synthetic-user",
            resource_ids: [...f.rows.keys()],
          })
        ).output,
      ),
      zip = await JSZip.loadAsync(bytes);
    const manifest = portableCollectionSchema.parse(
        JSON.parse(await zip.file("axiom-manifest.json")!.async("string")),
      ),
      note = manifest.resources.find((r) => r.id === f.ids.paper)!;
    const source = await zip.file(note.path)!.async("string");
    expect(source).toContain("%23");
    expect(source).toContain("%25");
    expect(
      source
        .replace(/<Methods[^>]+>/, `<${f.ids.methods}#Results>`)
        .replace(/(?<=\[plot\]: )\S+/, `/api/v1/attachments/${f.ids.version}`),
    ).toBe(original);
  });
  it("exports older pinned versions as separate logical files instead of silently rebinding current data", async () => {
    const f = await fixture(),
      older = randomUUID(),
      current = randomUUID(),
      asset = f.assets.get(f.ids.version)!;
    f.assets.set(older, { ...asset, id: older });
    f.assets.set(current, { ...asset, id: current });
    f.rows.get(f.ids.plot).current_version_id = current;
    f.rows.get(f.ids.paper).body = `![older](/api/v1/attachments/${older})`;
    const bytes = await output(
        (
          await buildPortableCollection(f.db, {
            user_id: "synthetic-user",
            resource_ids: [f.ids.paper, f.ids.plot],
          })
        ).output,
      ),
      zip = await JSZip.loadAsync(bytes),
      manifest = portableCollectionSchema.parse(
        JSON.parse(await zip.file("axiom-manifest.json")!.async("string")),
      );
    expect(
      manifest.resources.find((r) => r.id === older)?.metadata.name,
    ).toContain("pinned");
    expect(
      manifest.resources.find((r) => r.id === f.ids.plot)?.metadata
        .originVersionId,
    ).toBe(current);
    expect(manifest.artifacts.some((a) => a.versionId === older)).toBe(true);
  });
  it("fails safely before storage for excessive source, expansion, unavailable roots or missing disk reserve", async () => {
    const f = await fixture(),
      record = { user_id: "synthetic-user", resource_ids: [f.ids.paper] };
    f.rows.get(f.ids.paper).body = "x".repeat(25_000_001);
    await expect(buildPortableCollection(f.db, record)).rejects.toThrow(
      /25 MB/,
    );
    f.rows.get(f.ids.paper).body = "Small source";
    storage.free.mockResolvedValue(1);
    await expect(buildPortableCollection(f.db, record)).rejects.toThrow(
      /storage/,
    );
    storage.free.mockResolvedValue(null);
    await expect(
      buildPortableCollection(f.db, {
        ...record,
        resource_ids: [randomUUID()],
      }),
    ).rejects.toThrow(/no longer available/);
    f.assets.get(f.ids.version)!.bytes = 100_000_001;
    await expect(
      buildPortableCollection(f.db, { ...record, resource_ids: [f.ids.plot] }),
    ).rejects.toThrow(/100 MB expanded/);
  });
  it("rejects asset corruption during the stream instead of publishing a checksum claim", async () => {
    const f = await fixture();
    storage.stream.mockResolvedValue(Readable.from([Buffer.from("corrupted")]));
    const result = await buildPortableCollection(f.db, {
      user_id: "synthetic-user",
      resource_ids: [f.ids.plot],
    });
    await expect(output(result.output)).rejects.toThrow(
      /changed while exporting|not enough bytes/,
    );
  });
  it("enforces the actual compressed-output ceiling during streaming", async () => {
    const f = await fixture(),
      chunk = Buffer.alloc(1_000_000, 0x61),
      hash = createHash("sha256");
    for (let i = 0; i < 51; i++) hash.update(chunk);
    Object.assign(f.assets.get(f.ids.version)!, {
      bytes: 51_000_000,
      sha256: hash.digest("hex"),
    });
    storage.stream.mockImplementation(async () =>
      Readable.from(
        (function* () {
          for (let i = 0; i < 51; i++) yield chunk;
        })(),
      ),
    );
    const result = await buildPortableCollection(f.db, {
      user_id: "synthetic-user",
      resource_ids: [f.ids.plot],
    });
    await expect(
      (async () => {
        for await (const _chunk of result.output) {
          /* Drain without keeping a 50 MB allocation. */
        }
      })(),
    ).rejects.toThrow(/50 MB compressed/);
  });
});
