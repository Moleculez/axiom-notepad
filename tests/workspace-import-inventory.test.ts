import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { prepareImportInventory } from "../apps/web/lib/workspace-import-inventory";
import { filePart, importFileDigest } from "../apps/web/lib/file-checksum";
import { UPLOAD_CHUNK_BYTES } from "../packages/shared/src/workspace";

const file = (name: string, contents: string | Uint8Array = "") =>
  new File(
    [typeof contents === "string" ? contents : new Uint8Array(contents)],
    name,
  );
describe("pure worker inventory", () => {
  it("builds native empty/BOM notes and bounded part identities without a page API client", async () => {
    const original = file("Research.md", "\ufeff# Research\r\n"),
      empty = file("Empty.md");
    const result = await prepareImportInventory({
      source: "markdown",
      files: [original, empty].map((f) => ({ path: f.name, file: f })),
    });
    expect(result.previews[original.name]).toBe("\ufeff# Research\r\n");
    expect(result.previews[empty.name]).toBe("");
    expect(result.entries.every((e) => e.kind === "note")).toBe(true);
    expect(result.entries.find((e) => e.path === empty.name)?.digest).toBe(
      createHash("sha256").update("").digest("hex"),
    );
  });
  it("preserves reported empty directories, derives all parents and excludes secrets", async () => {
    const result = await prepareImportInventory({
      source: "folder",
      directories: ["Lab/Empty/Nested"],
      files: [
        { path: "Lab/Paper.md", file: file("Paper.md", "# Paper") },
        { path: "Lab/.env", file: file(".env", "SYNTHETIC=1") },
        { path: "Lab/Data/results.csv", file: file("results.csv", "x,y\n1,2") },
      ],
    });
    expect(
      result.entries.filter((e) => e.kind === "folder").map((e) => e.path),
    ).toEqual(
      expect.arrayContaining([
        "Lab",
        "Lab/Empty",
        "Lab/Empty/Nested",
        "Lab/Data",
      ]),
    );
    expect(result.files).toHaveLength(2);
    expect(result.exclusions).toEqual([
      { path: "Lab/.env", reason: "Likely credentials or private key" },
    ]);
  });
  it("unpacks validated ZIPs with known empty folders and strict CRC checks", async () => {
    const zip = new JSZip();
    zip.folder("Lab/Empty");
    zip.file("Lab/α.md", "# Research α");
    const bytes = await zip.generateAsync({
      type: "uint8array",
      compression: "STORE",
    });
    const result = await prepareImportInventory({
      source: "zip",
      files: [{ path: "Lab.zip", file: file("Lab.zip", bytes) }],
    });
    expect(result.previews["Lab/α.md"]).toBe("# Research α");
    expect(result.entries.find((e) => e.path === "Lab/Empty")).toMatchObject({
      kind: "folder",
    });
    const broken = bytes.slice(),
      text = new TextEncoder().encode("# Research α"),
      from = broken.findIndex(
        (byte, i) =>
          byte === text[0] && text.every((b, j) => broken[i + j] === b),
      );
    expect(from).toBeGreaterThan(0);
    broken[from] = 0x21;
    await expect(
      prepareImportInventory({
        source: "zip",
        files: [{ path: "Lab.zip", file: file("Lab.zip", broken) }],
      }),
    ).rejects.toThrow(/checksum/);
  });
  it("rejects malformed UTF-8, path ambiguity and non-Markdown in Markdown mode", async () => {
    await expect(
      prepareImportInventory({
        source: "markdown",
        files: [{ path: "a.md", file: file("a.md", new Uint8Array([0xff])) }],
      }),
    ).rejects.toThrow(/UTF-8/);
    await expect(
      prepareImportInventory({
        source: "markdown",
        files: [{ path: "a.bin", file: file("a.bin") }],
      }),
    ).rejects.toThrow(/Choose .md/);
    await expect(
      prepareImportInventory({
        source: "markdown",
        files: ["a.md", "A.md"].map((name) => ({
          path: name,
          file: file(name),
        })),
      }),
    ).rejects.toThrow(/ambiguous/);
  });
  it("checksums a multi-part file using only part-sized slices", async () => {
    const original = file(
        "data.bin",
        new Uint8Array(UPLOAD_CHUNK_BYTES + 19).fill(31),
      ),
      parts = [
        (await filePart(original, 1)).checksum,
        (await filePart(original, 2)).checksum,
      ],
      progress: number[] = [];
    expect(
      await importFileDigest(original, (bytes) => progress.push(bytes)),
    ).toBe(createHash("sha256").update(parts.join("")).digest("hex"));
    expect(progress).toEqual([UPLOAD_CHUNK_BYTES, original.size]);
  });
});
