import { describe, it, expect, afterEach } from "vitest";
import * as Y from "yjs";
import JSZip from "jszip";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import {
  mathSymbols,
  mathSymbolFields,
} from "../packages/editor/src/math-symbols";
import {
  officeDirectoryType,
  detectPrefix,
} from "../packages/shared/src/file-detection";
import {
  previewKind,
  officeMimes,
  parseDelimited,
} from "../packages/shared/src/file-preview";
import {
  sealCredential,
  openCredential,
  providerEndpoint,
} from "../packages/shared/src/tool-providers";
import { resourceAnchor } from "../packages/shared/src/resource-comments-api";
import { NativeBinding } from "../packages/editor/src/binding";
import { tabRoute, tabTitle } from "../packages/shared/src/application-tabs";
import {
  mathProjectSettings,
  imageProjectManifest,
  isProjectPng,
} from "../packages/shared/src/research-tools";
import { mathBridgeReplacement } from "../apps/web/lib/tools/math-note-bridge";
const previews = JSON.parse(
  readFileSync(
    new URL("../apps/web/lib/icons/math-symbol-data.json", import.meta.url),
    "utf8",
  ),
);
describe("studio input boundaries", () => {
  it("bounds typography and accepts only color values, not CSS", () => {
    expect(mathProjectSettings.parse({}).fontSize).toBe(28);
    for (const value of [
      { fontSize: 9000 },
      { foreground: "url(https://example.com)" },
      { macros: "x".repeat(15001) },
    ])
      expect(mathProjectSettings.safeParse(value).success).toBe(false);
  });
  it("rejects over-budget images and invalid PNG dimensions before decoding", () => {
    expect(
      imageProjectManifest.safeParse({
        format: "axiom-image",
        version: 1,
        width: 8192,
        height: 8192,
        layers: [],
      }).success,
    ).toBe(false);
    expect(isProjectPng(new Uint8Array(30), 10, 10)).toBe(false);
  });
  it("preserves quoted CRLF math fences when returning a studio result", () => {
    expect(
      mathBridgeReplacement({
        projectId: "",
        noteId: "",
        noteTitle: "",
        anchor: { start: [], end: [], quote: "", generation: 1 },
        before: "$$\r\n> ",
        after: "\r\n> $$",
        prefix: "> ",
        ending: "\r\n",
        result: "a\n+b",
      }),
    ).toBe("$$\r\n> a\r\n> +b\r\n> $$");
  });
});
describe("shared math symbol presentation", () => {
  it("has unique symbols and a trusted preview for every item", () => {
    expect(mathSymbols.length).toBeGreaterThan(150);
    expect(new Set(mathSymbols.map((s) => s.id)).size).toBe(mathSymbols.length);
    expect(Object.keys(previews).sort()).toEqual(
      mathSymbols.map((s) => s.id).sort(),
    );
    for (const s of mathSymbols) {
      expect(previews[s.id]).toMatch(/^<svg[\s>]/);
      expect(previews[s.id]).not.toMatch(
        /<script|<foreignObject|<image|\bon[a-z]+=|https?:\/\/(?!www\.w3\.org)/i,
      );
    }
  });
  it("keeps exact placeholder ranges for familiar templates", () => {
    for (const s of mathSymbols) {
      const fields = mathSymbolFields(s);
      for (const [from, to] of fields) {
        expect(from).toBeGreaterThanOrEqual(0);
        expect(to).toBeLessThanOrEqual(s.insert.length);
      }
      if (s.id === "frac")
        expect(fields.map(([a, b]) => s.insert.slice(a, b))).toEqual([
          "numerator",
          "denominator",
        ]);
    }
  });
  it("shares only local-author undo across bounded source transactions", () => {
    const a = new Y.Doc(),
      b = new Y.Doc();
    a.getText("markdown").insert(0, "x^2 + y^2");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const binding = new NativeBinding(
      a,
      new Y.UndoManager(a.getText("markdown")),
      null,
    );
    binding.transact({
      kind: "typing",
      changes: [{ from: 0, to: 1, insert: "z" }],
      selection: { anchor: 1, head: 1 },
    });
    b.getText("markdown").insert(9, " = 1");
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    binding.history(false);
    expect(binding.source).toBe("x^2 + y^2 = 1");
    binding.destroy();
    a.destroy();
    b.destroy();
  });
});
describe("safe preview routing", () => {
  it.each([
    ["audio/mpeg", "recording.mp3", "audio"],
    ["video/mp4", "lecture.mp4", "video"],
    ["text/plain", "paper.md", "markdown"],
    ["text/plain", "results.tsv", "table"],
    [officeMimes.xlsx, "data.xlsx", "workbook"],
    [officeMimes.docx, "paper.docx", "office"],
    ["application/octet-stream", "evil.docx", "download"],
    ["application/vnd.axiom.image+zip", "figure.axiom-image", "image-project"],
  ])("routes %s without trusting the extension alone", (mime, name, kind) =>
    expect(previewKind(mime, name)).toBe(kind),
  );
  it("recognizes UTF-8 text and rejects disguised binaries", async () => {
    expect(await detectPrefix(Buffer.from("α β\n中文"), "notes.txt")).toBe(
      "text/plain",
    );
    expect(await detectPrefix(Buffer.from([0, 2, 128, 255]), "notes.txt")).toBe(
      "application/octet-stream",
    );
    expect(await detectPrefix(Buffer.from("hello"), "payload.exe")).toBe(
      "application/octet-stream",
    );
  });
  it("handles quoted multiline CSV, escaped quotes and BOM", () =>
    expect(
      parseDelimited('\ufeffA,B\r\n"one,two","a""b"\r\n"line\ninside",x'),
    ).toEqual([
      ["A", "B"],
      ["one,two", 'a"b'],
      ["line\ninside", "x"],
    ]));
  it("bounds CSV rows and parses TSV without evaluating formulas", () => {
    expect(parseDelimited("=SUM(A1)\tvalue\n2\t3", "\t", 1)).toEqual([
      ["=SUM(A1)", "value"],
    ]);
  });
  async function directory(names: string[]) {
    const zip = new JSZip();
    for (const name of names) zip.file(name, "<xml/>");
    const bytes = await zip.generateAsync({ type: "nodebuffer" }),
      end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    return bytes.subarray(
      bytes.readUInt32LE(end + 16),
      bytes.readUInt32LE(end + 16) + bytes.readUInt32LE(end + 12),
    );
  }
  it("recognizes actual OOXML ZIP structures", async () => {
    expect(
      officeDirectoryType(
        await directory(["[Content_Types].xml", "word/document.xml"]),
      ),
    ).toBe(officeMimes.docx);
    expect(
      officeDirectoryType(
        await directory(["[Content_Types].xml", "xl/workbook.xml"]),
      ),
    ).toBe(officeMimes.xlsx);
  });
  it("rejects truncated, mixed-format and macro-bearing ZIP directories", async () => {
    const good = await directory(["[Content_Types].xml", "word/document.xml"]);
    expect(officeDirectoryType(good.subarray(0, -1))).toBeUndefined();
    expect(
      officeDirectoryType(Buffer.concat([good, Buffer.from([1])])),
    ).toBeUndefined();
    expect(
      officeDirectoryType(
        await directory([
          "[Content_Types].xml",
          "word/document.xml",
          "word/vbaProject.bin",
        ]),
      ),
    ).toBeUndefined();
    expect(
      officeDirectoryType(
        await directory([
          "[Content_Types].xml",
          "word/document.xml",
          "xl/workbook.xml",
        ]),
      ),
    ).toBeUndefined();
  });
  it("validates normalized annotation anchors", () => {
    expect(
      resourceAnchor.safeParse({ kind: "image", x: 1.01, y: 0.5 }).success,
    ).toBe(false);
    expect(
      resourceAnchor.safeParse({ kind: "time", seconds: -1 }).success,
    ).toBe(false);
    expect(
      resourceAnchor.parse({ kind: "cell", sheet: "Sheet1", cell: "BC42" }),
    ).toMatchObject({ cell: "BC42" });
  });
  it("persists tools in existing tabs without persisting research source or secrets", () => {
    expect(
      tabRoute("/tools/math/abc?source=secret&token=secret&version=v"),
    ).toBe("/math/abc?version=v");
    expect(tabTitle("/tools")).toBe("Explorer");
    expect(tabTitle("/tools/math/new")).toBe("Explorer");
    expect(tabTitle("/tools/math/abc")).toBe("Math");
    expect(tabTitle("/tools/image/abc?version=v")).toBe("Image");
    expect(tabTitle("/tools/viewer")).toBe("Explorer");
  });
});
describe("provider credential boundaries", () => {
  const previous = {
    key: process.env.TOOL_PROVIDER_KEY,
    origins: process.env.TOOL_PROVIDER_ALLOWED_ORIGINS,
  };
  afterEach(() => {
    if (previous.key === undefined) delete process.env.TOOL_PROVIDER_KEY;
    else process.env.TOOL_PROVIDER_KEY = previous.key;
    if (previous.origins === undefined)
      delete process.env.TOOL_PROVIDER_ALLOWED_ORIGINS;
    else process.env.TOOL_PROVIDER_ALLOWED_ORIGINS = previous.origins;
  });
  it("requires a dedicated key and authenticates encrypted credentials", () => {
    delete process.env.TOOL_PROVIDER_KEY;
    expect(() => sealCredential("test-secret")).toThrow(/TOOL_PROVIDER_KEY/);
    process.env.TOOL_PROVIDER_KEY = randomBytes(32).toString("base64");
    const encrypted = sealCredential("test-secret");
    expect(encrypted).not.toContain("test-secret");
    expect(openCredential(encrypted)).toBe("test-secret");
    const altered = Buffer.from(encrypted, "base64");
    altered[20] ^= 1;
    expect(() => openCredential(altered.toString("base64"))).toThrow();
  });
  it("restricts private endpoints to exact operator-allowlisted origins", () => {
    process.env.TOOL_PROVIDER_ALLOWED_ORIGINS = "http://private-inference:8000";
    expect(
      providerEndpoint("private", "http://private-inference:8000/v1").href,
    ).toBe("http://private-inference:8000/v1/");
    expect(() =>
      providerEndpoint("private", "http://169.254.169.254/latest/"),
    ).toThrow();
    expect(() =>
      providerEndpoint(
        "private",
        "http://user:secret@private-inference:8000/v1",
      ),
    ).toThrow();
    expect(providerEndpoint("openrouter", "http://evil.test/").href).toBe(
      "https://openrouter.ai/api/v1/",
    );
  });
});
