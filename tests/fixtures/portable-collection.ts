import { createHash } from "node:crypto";
import JSZip from "jszip";
import { portableCollectionSchema } from "../../packages/shared/src/portable-collection";

/** Synthetic only; shared by pure inventories and fenced browser imports. */
export async function portableCollectionFixture() {
  const ids = {
    folder: "10000000-0000-4000-8000-000000000001",
    paper: "10000000-0000-4000-8000-000000000002",
    methods: "10000000-0000-4000-8000-000000000003",
    canvas: "10000000-0000-4000-8000-000000000004",
    math: "10000000-0000-4000-8000-000000000005",
    text: "10000000-0000-4000-8000-000000000006",
    image: "10000000-0000-4000-8000-000000000007",
    raw: "10000000-0000-4000-8000-000000000008",
    plot: "10000000-0000-4000-8000-000000000009",
    version: "20000000-0000-4000-8000-000000000009",
  };
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHh0AAAAASUVORK5CYII=", "base64");
  const imageZip = new JSZip();
  imageZip.file("manifest.json", JSON.stringify({ format: "axiom-image", version: 1, width: 1, height: 1, layers: [] }));
  imageZip.file("preview.png", png);
  const texts: Record<string, string> = {
    "Lab/Paper.md": '\ufeff# Paper\r\n\r\n[**Methods**](Methods.md#Results "unchanged title")\r\n\r\n![Plot][fig]\r\n\r\n[fig]: <plot%20%2350%25.png> "original"\r\n\r\n`[literal](Methods.md)`\r\n',
    "Lab/Methods.md": "# Results\n\n$$E=mc^2$$\n",
    "Lab/Board.canvas": JSON.stringify({ schemaVersion: 1, externalMetadata: { preserved: true }, nodes: [
      { id: "original-text", type: "text", x: 0, y: 0, width: 300, height: 200, heightMode: "auto", title: "Research", text: "[Paper](Paper.md)", vendorData: true },
      { id: "original-file", type: "file", x: 400, y: 0, width: 300, height: 200, file: "plot #50%.png", resourceId: ids.plot, versionId: ids.version },
    ], edges: [{ id: "original-edge", fromNode: "original-text", toNode: "original-file", fromSide: "right", toSide: "left" }] }),
    "Lab/Formula.tex": "\\int_0^1 x^2\\,dx=\\frac13",
    "Lab/Draft.txt": "Plain research source\r\n",
    "Lab/Raw.md": "# Immutable supporting file\n",
  };
  const files = new Map<string, Uint8Array>(Object.entries(texts).map(([path, text]) => [path, Buffer.from(text)]));
  files.set("Lab/Picture.axiom-image", await imageZip.generateAsync({ type: "uint8array" }));
  files.set("Lab/plot #50%.png", png);
  const resources = [
    { id: ids.folder, parentId: null, kind: "folder", path: "Lab", metadata: { name: "Research collection", tags: ["physics"] } },
    ...([
      ["paper", "Paper.md", "markdown", undefined], ["methods", "Methods.md", "markdown", undefined],
      ["canvas", "Board.canvas", "canvas", "canvas"], ["math", "Formula.tex", "latex", "math"],
      ["text", "Draft.txt", "text", "text"], ["image", "Picture.axiom-image", undefined, "image"],
      ["raw", "Raw.md", undefined, undefined], ["plot", "plot #50%.png", undefined, undefined],
    ] as const).map(([key, filename, sourceFormat, toolKind]) => ({
      id: ids[key], parentId: ids.folder, kind: sourceFormat ? "note" : "file", path: "Lab/" + filename,
      ...(sourceFormat ? { sourceFormat } : {}),
      metadata: { name: filename, description: "Synthetic fixture", tags: ["research"], ...(toolKind ? { toolKind, settings: toolKind === "math" ? { macros: "\\newcommand{\\R}{\\mathbb{R}}", fontSize: 32 } : {} } : {}) },
    })),
  ];
  const manifest = portableCollectionSchema.parse({
    format: "axiom-collection", version: 1, scope: "files-and-metadata", createdAt: "2026-10-06T00:00:00.000Z",
    resources, artifacts: resources.filter(r => r.kind !== "folder").map(resource => ({
      path: resource.path, role: resource.kind === "note" ? "source" : "asset", resourceId: resource.id,
      ...(resource.id === ids.plot ? { versionId: ids.version } : {}),
      bytes: files.get(resource.path)!.byteLength, sha256: createHash("sha256").update(files.get(resource.path)!).digest("hex"),
    })), diagnostics: [],
  });
  return { ids, files, manifest };
}

export async function portableCollectionZip() {
  const fixture = await portableCollectionFixture(), zip = new JSZip();
  for (const [path, bytes] of fixture.files) zip.file(path, bytes);
  zip.file("axiom-manifest.json", JSON.stringify(fixture.manifest));
  return { ...fixture, zip, bytes: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }) };
}
