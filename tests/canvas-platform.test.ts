import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import JSZip from "jszip";
import { XMLValidator } from "fast-xml-parser";
import {
  applyCanvasCommands,
  canvasBounds,
  parseCanvas,
  readCanvas,
  seedCanvas,
  captureCanvasComposition,
  finishCanvasComposition,
  type CanvasNode,
} from "../packages/shared/src/canvas";
import {
  initializeDocument,
  documentSource,
  validateDocument,
} from "../packages/shared/src/document-format";
import {
  applyDocumentCommand,
  sourceHash,
} from "../packages/shared/src/document-commands";
import { officeTemplate } from "../packages/shared/src/office-templates";
import { offlineMutation } from "../packages/shared/src/offline";
import { integrationActions } from "../packages/shared/src/integration-catalog";
import { blankImageProject } from "../packages/shared/src/blank-image";
import { NativeBinding } from "../packages/editor/src/binding";
const node = (id: string, text = id): CanvasNode => ({
  id,
  type: "text",
  text,
  x: 0,
  y: 0,
  width: 300,
  height: 200,
});
describe("native JSON Canvas", () => {
  it("binds rich editors to nested card text without touching Markdown or another author's edits", () => {
    const doc = new Y.Doc(),
      peer = new Y.Doc();
    seedCanvas(doc, {
      nodes: [node("a", "Alpha"), node("b", "Beta")],
      edges: [],
    });
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    const text = (doc.getMap("canvas").get("nodes") as Y.Map<Y.Map<unknown>>)
      .get("a")!
      .get("text") as Y.Text;
    const remote = (peer.getMap("canvas").get("nodes") as Y.Map<Y.Map<unknown>>)
      .get("a")!
      .get("text") as Y.Text;
    const undo = new Y.UndoManager(doc.getMap("canvas"), {
      trackedOrigins: new Set(),
    });
    const binding = new NativeBinding(doc, undo, null, text);
    binding.transact({
      kind: "typing",
      changes: [{ from: 5, to: 5, insert: " local" }],
      selection: { anchor: 11, head: 11 },
    });
    remote.insert(0, "Peer ");
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));
    expect(binding.source).toBe("Peer Alpha local");
    expect(binding.selection()).toEqual({ anchor: 16, head: 16 });
    binding.history(false);
    expect(binding.source).toBe("Peer Alpha");
    expect(readCanvas(doc).nodes.find((n) => n.id === "b")).toMatchObject({
      text: "Beta",
    });
    expect(doc.share.has("markdown")).toBe(false);
    binding.history(true);
    expect(binding.source).toBe("Peer Alpha local");
    binding.destroy();
    undo.destroy();
    doc.destroy();
    peer.destroy();
  });
  it("keeps concurrent insertions while an IME replaces the original selection", () => {
    const a = new Y.Doc(),
      b = new Y.Doc(),
      text = a.getText("text");
    text.insert(0, "abc");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const capture = captureCanvasComposition(text);
    b.getText("text").insert(1, "R");
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    finishCanvasComposition(text, capture, "aXc", "local");
    expect(text.toString()).toBe("aRXc");
    a.destroy();
    b.destroy();
  });
  it("rejects unknown structural commands instead of acknowledging a no-op", () => {
    const doc = new Y.Doc();
    seedCanvas(doc, { nodes: [node("a")], edges: [] });
    expect(() =>
      applyCanvasCommands(doc, [{ type: "typo" } as never], "local"),
    ).toThrow();
    doc.destroy();
  });
  it("round trips cards, edges, order and extension metadata", () => {
    const data = parseCanvas(
        JSON.stringify({
          nodes: [{ ...node("a"), custom: { research: "physics" } }, node("b")],
          edges: [{ id: "ab", fromNode: "a", toNode: "b", label: "implies" }],
          custom: { version: 1 },
        }),
      ),
      doc = new Y.Doc();
    seedCanvas(doc, data);
    expect(readCanvas(doc)).toEqual(data);
    expect(() => validateDocument(doc, "canvas")).not.toThrow();
    doc.destroy();
  });
  it("does not corrupt a live document on an invalid batch", () => {
    const doc = new Y.Doc();
    seedCanvas(doc, { nodes: [node("a")], edges: [] });
    const before = documentSource(doc, "canvas");
    expect(() =>
      applyCanvasCommands(
        doc,
        [
          { type: "update-node", id: "a", changes: { x: 22 } },
          {
            type: "add",
            edges: [{ id: "e", fromNode: "a", toNode: "missing" }],
          },
        ],
        "local",
      ),
    ).toThrow();
    expect(documentSource(doc, "canvas")).toBe(before);
    doc.destroy();
  });
  it("merges concurrent geometry and text edits and scopes local undo", () => {
    const a = new Y.Doc(),
      b = new Y.Doc();
    seedCanvas(a, { nodes: [node("a", "original"), node("b")], edges: [] });
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const undo = new Y.UndoManager(a.getMap("canvas"), {
      trackedOrigins: new Set(["local"]),
    });
    applyCanvasCommands(
      a,
      [{ type: "update-node", id: "a", changes: { x: 100 } }],
      "local",
    );
    applyCanvasCommands(
      b,
      [
        { type: "update-node", id: "a", changes: { text: "collaborator" } },
        { type: "update-node", id: "b", changes: { y: 80 } },
      ],
      "remote",
    );
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(readCanvas(a)).toEqual(readCanvas(b));
    expect(readCanvas(a).nodes[0]).toMatchObject({
      x: 100,
      text: "collaborator",
    });
    undo.undo();
    expect(readCanvas(a).nodes[0]).toMatchObject({
      x: 0,
      text: "collaborator",
    });
    undo.destroy();
    a.destroy();
    b.destroy();
  });
  it("removes incident connections and rejects edits to deleted cards", () => {
    const doc = new Y.Doc();
    seedCanvas(doc, {
      nodes: [node("a"), node("b")],
      edges: [{ id: "ab", fromNode: "a", toNode: "b" }],
    });
    applyCanvasCommands(doc, [{ type: "remove", ids: ["a"] }], "local");
    expect(readCanvas(doc)).toMatchObject({ nodes: [node("b")], edges: [] });
    expect(() =>
      applyCanvasCommands(
        doc,
        [{ type: "update-node", id: "a", changes: { x: 5 } }],
        "local",
      ),
    ).toThrow();
    doc.destroy();
  });
  it("rejects unsafe links, duplicate IDs and dangling imports", () => {
    for (const data of [
      { nodes: [node("a"), node("a")], edges: [] },
      {
        nodes: [{ ...node("a"), type: "link", url: "javascript:alert(1)" }],
        edges: [],
      },
      {
        nodes: [node("a")],
        edges: [{ id: "e", fromNode: "a", toNode: "missing" }],
      },
    ])
      expect(() => parseCanvas(JSON.stringify(data))).toThrow();
    expect(canvasBounds([node("a"), { ...node("b"), x: 350, y: -50 }])).toEqual(
      { x: 0, y: -50, width: 650, height: 250 },
    );
  });
});
describe("document command fencing", () => {
  it.each(["markdown", "latex", "text"] as const)(
    "preserves %s source and rejects stale changes",
    (format) => {
      const doc = new Y.Doc();
      initializeDocument(doc, "A", format);
      const command = {
        mutationId: crypto.randomUUID(),
        noteId: crypto.randomUUID(),
        generation: 1,
        expectedHash: sourceHash("A"),
        source: "A + B",
      };
      applyDocumentCommand(doc, format, command);
      expect(documentSource(doc, format)).toBe("A + B");
      expect(() => applyDocumentCommand(doc, format, command)).toThrow(
        /changed/,
      );
      doc.destroy();
    },
  );
  it("does not create a canvas root when serializing Markdown", () => {
    const doc = new Y.Doc();
    initializeDocument(doc, "text");
    expect(documentSource(doc)).toBe("text");
    expect([...doc.share.keys()]).toEqual(["markdown"]);
    doc.destroy();
  });
});
describe("new-file templates", () => {
  it("creates an immediately valid layered drawing with a matching preview", async () => {
    const bundle = await blankImageProject(),
      zip = await JSZip.loadAsync(bundle.data);
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    expect(manifest).toMatchObject({
      format: "axiom-image",
      width: 1200,
      height: 800,
    });
    expect(zip.file(manifest.layers[0].asset)).not.toBeNull();
    expect(await zip.file("preview.png")!.async("nodebuffer")).toEqual(
      bundle.preview,
    );
  });
  it.each(["docx", "xlsx", "pptx"] as const)(
    "produces a valid nonempty %s package",
    async (type) => {
      const file = await officeTemplate(type),
        zip = await JSZip.loadAsync(file.data);
      expect(file.data.length).toBeGreaterThan(500);
      expect(zip.file("[Content_Types].xml")).not.toBeNull();
      expect(zip.file("_rels/.rels")).not.toBeNull();
      for (const entry of Object.values(zip.files).filter(
        (f) => !f.dir && /\.(xml|rels)$/.test(f.name),
      ))
        expect(
          XMLValidator.validate(await entry.async("text")),
          entry.name,
        ).toBe(true);
    },
  );
});
describe("offline and automation boundary", () => {
  it("queues only explicitly supported everyday operations", () => {
    expect(offlineMutation("files/new", "POST", { type: "canvas" })).toBe(
      "create",
    );
    expect(
      offlineMutation(`resources/${crypto.randomUUID()}`, "PATCH", {
        version: 1,
        name: "Renamed",
      }),
    ).toBe("update");
    for (const [path, method, body] of [
      ["groups", "POST", {}],
      ["files/new", "POST", { type: "image" }],
      [`resources/${crypto.randomUUID()}/purge`, "POST", {}],
      ["connections/consent", "POST", {}],
    ] as const)
      expect(offlineMutation(path, method, body)).toBeNull();
  });
  it("requires approval for every destructive and access-changing capability", () => {
    expect(new Set(integrationActions.map((a) => a.name)).size).toBe(
      integrationActions.length,
    );
    for (const action of integrationActions.filter(
      (a) =>
        /trash|purge|transfer|invite|members_update|workspace_update/.test(
          a.name,
        ) && a.method !== "GET",
    ))
      expect(action.approval, action.name).toBe(true);
    expect(
      integrationActions.some((a) =>
        /password|credential|sign.in|sql|shell/.test(a.path),
      ),
    ).toBe(false);
  });
});
