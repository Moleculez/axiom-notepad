import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { transform } from "esbuild";
import {
  makePluginPackage,
  readPluginPackage,
} from "../packages/shared/src/plugin-package";
import {
  pluginManifestSchema,
  validatePluginPanel,
  pluginRpcSchema,
  compatiblePluginSettings,
} from "../packages/shared/src/plugins";
import {
  pluginActionCapability,
  pluginsEnabled,
  pluginImportsEnabled,
  requirePlugins,
} from "../packages/shared/src/plugin-security";
import { pilotPackages } from "../packages/shared/src/plugin-pilots";
import {
  pluginSandboxCsp,
  pluginSandboxDocument,
} from "../packages/shared/src/plugin-sandbox";

const manifest = pluginManifestSchema.parse({
  format: "axiom-plugin",
  apiVersion: 1,
  id: "example.health",
  name: "Health",
  version: "1.0.0",
  description: "Read a saved research document.",
  author: "Example",
  license: "MIT",
  entry: "main.js",
  capabilities: ["documents:read"],
  commands: [
    {
      id: "example.health.inspect",
      title: "Inspect",
      description: "Inspect a snapshot",
    },
  ],
});
const bundle =
  "export default {async run(api){await api.render({title:'Health',blocks:[]});}};";
describe("sandboxed extension contracts", () => {
  it("requires deliberate literal-true gates, with imports independently disabled", () => {
    try {
      for (const value of [undefined, "false", "1", "TRUE", "on"]) {
        vi.stubEnv("AXIOM_PLUGINS_ENABLED", value);
        vi.stubEnv("AXIOM_PLUGIN_IMPORTS_ENABLED", "true");
        expect(pluginsEnabled()).toBe(false);
        expect(pluginImportsEnabled()).toBe(false);
        expect(requirePlugins).toThrow(/disabled/);
      }
      vi.stubEnv("AXIOM_PLUGINS_ENABLED", "true");
      vi.stubEnv("AXIOM_PLUGIN_IMPORTS_ENABLED", undefined);
      expect(pluginsEnabled()).toBe(true);
      expect(pluginImportsEnabled()).toBe(false);
      vi.stubEnv("AXIOM_PLUGIN_IMPORTS_ENABLED", "true");
      expect(pluginImportsEnabled()).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("documents disabled deployment defaults and forwards both gates to all Compose app services", () => {
    for (const file of [
      ".env.example",
      ".env.production.example",
      "deploy/native/axiom.env.example",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source).toMatch(/^AXIOM_PLUGINS_ENABLED=false$/m);
      expect(source).toMatch(/^AXIOM_PLUGIN_IMPORTS_ENABLED=false$/m);
    }
    const compose = readFileSync("compose.yaml", "utf8");
    expect(compose).toContain(
      "AXIOM_PLUGINS_ENABLED: ${AXIOM_PLUGINS_ENABLED:-false}",
    );
    expect(compose).toContain(
      "AXIOM_PLUGIN_IMPORTS_ENABLED: ${AXIOM_PLUGIN_IMPORTS_ENABLED:-false}",
    );
  });
  it("makes immutable, deterministic, independently validated ZIP packages", async () => {
    const a = await makePluginPackage(manifest, bundle),
      b = await makePluginPackage(manifest, bundle);
    expect(a.hash).toBe(b.hash);
    expect(readPluginPackage(a.archive).manifest).toEqual(manifest);
    expect(
      (await makePluginPackage({ ...manifest, version: "1.0.1" }, bundle)).hash,
    ).not.toBe(a.hash);
  });
  it("rejects malformed manifests, unsafe paths, hidden assets and broken ZIPs", async () => {
    expect(
      pluginManifestSchema.safeParse({
        ...manifest,
        commands: [{ ...manifest.commands[0], id: "other.command" }],
      }).success,
    ).toBe(false);
    expect(
      pluginManifestSchema.safeParse({
        ...manifest,
        capabilities: ["network:fetch"],
      }).success,
    ).toBe(false);
    expect(
      pluginManifestSchema.safeParse({ ...manifest, html: "<button>" }).success,
    ).toBe(false);
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify(manifest));
    zip.file("main.js", bundle);
    zip.file("../secret.txt", "secret");
    expect(() => readPluginPackage(Buffer.from("not a zip"))).toThrow();
    expect(() => readPluginPackage(Buffer.alloc(5 * 1024 * 1024 + 1))).toThrow(
      /5 MiB/,
    );
    expect(() => readPluginPackage(Buffer.from([]))).toThrow();
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    expect(() => readPluginPackage(bytes)).toThrow(/Unsafe/);
    zip.remove("../secret.txt");
    zip.remove("../");
    zip.file("styles.css", "body{}");
    expect(() =>
      readPluginPackage(bytes.subarray(0, bytes.length - 1)),
    ).toThrow();
    expect(() => readPluginPackage(Buffer.from(bytes).fill(0, 0, 4))).toThrow();
    const assets = await zip.generateAsync({ type: "nodebuffer" });
    expect(() => readPluginPackage(assets)).toThrow(/Only/);
  });
  it("rejects bad checksums, duplicate names, overlapping entries and compression bombs", async () => {
    const a = await makePluginPackage(manifest, bundle),
      bad = Buffer.from(a.archive),
      central = bad.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bad.writeUInt32LE(0, central + 16);
    expect(() => readPluginPackage(bad)).toThrow(/checksum/);
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify(manifest));
    zip.file("main.js", bundle);
    zip.file("MAIN.js", bundle);
    const duplicate = await zip.generateAsync({ type: "nodebuffer" });
    expect(() => readPluginPackage(duplicate)).toThrow(/duplicate/);
    const nested = new JSZip();
    nested.file("README.md", "nested");
    const inner = await nested.generateAsync({ type: "nodebuffer" });
    const localEntry = inner.subarray(
      0,
      inner.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])),
    );
    const outer = new JSZip();
    outer.file("manifest.json", JSON.stringify(manifest));
    outer.file("main.js", localEntry);
    outer.file("README.md", "nested");
    const overlap = await outer.generateAsync({ type: "nodebuffer" });
    let directory = overlap.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])),
      mainData = 0;
    for (let i = 0; i < 3; i++) {
      const length = overlap.readUInt16LE(directory + 28),
        name = overlap
          .subarray(directory + 46, directory + 46 + length)
          .toString(),
        local = overlap.readUInt32LE(directory + 42);
      if (name === "main.js")
        mainData =
          local +
          30 +
          overlap.readUInt16LE(local + 26) +
          overlap.readUInt16LE(local + 28);
      if (name === "README.md") overlap.writeUInt32LE(mainData, directory + 42);
      directory +=
        46 +
        length +
        overlap.readUInt16LE(directory + 30) +
        overlap.readUInt16LE(directory + 32);
    }
    expect(() => readPluginPackage(overlap)).toThrow(/Overlapping/);
    const bomb = new JSZip();
    bomb.file("manifest.json", JSON.stringify(manifest));
    bomb.file("main.js", "a".repeat(10 * 1024 * 1024 + 1));
    expect(() =>
      readPluginPackage(Buffer.from(a.archive).subarray(1)),
    ).toThrow();
    const big = await bomb.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
    expect(() => readPluginPackage(big)).toThrow(/10 MiB/);
  });
  it("validates field defaults and projects only type-compatible configuration", () => {
    const updated = pluginManifestSchema.parse({
      ...manifest,
      settings: [
        { id: "name", label: "Name", type: "text", value: "Default" },
        { id: "count", label: "Count", type: "number", value: 2 },
        { id: "enabled", label: "Enabled", type: "checkbox" },
        {
          id: "choice",
          label: "Choice",
          type: "select",
          options: [{ value: "a", label: "A" }],
          value: "a",
        },
      ],
    });
    expect(
      compatiblePluginSettings(updated, {
        name: "Retained",
        count: "not a number",
        enabled: false,
        choice: "removed",
        removed: "Gone",
      }),
    ).toEqual({ name: "Retained", count: 2, enabled: false, choice: "a" });
    for (const field of [
      { id: "test", label: "Test", type: "number", value: "wrong" },
      {
        id: "test",
        label: "Test",
        type: "select",
        options: [{ value: "a", label: "A" }],
        value: "b",
      },
      {
        id: "test",
        label: "Test",
        type: "select",
        options: [
          { value: "a", label: "A" },
          { value: "a", label: "Again" },
        ],
      },
    ])
      expect(
        pluginManifestSchema.safeParse({ ...manifest, settings: [field] })
          .success,
      ).toBe(false);
  });
  it("allows native declarative panels but no HTML, CSS, scripts, foreign actions or arbitrary URLs", () => {
    expect(
      validatePluginPanel(
        {
          title: "Check",
          blocks: [
            {
              kind: "field",
              field: { id: "name", label: "Name", type: "text" },
            },
            {
              kind: "action",
              label: "Check",
              command: "example.health.inspect",
            },
          ],
        },
        manifest,
      ).blocks,
    ).toHaveLength(2);
    for (const block of [
      { kind: "html", html: "<img>" },
      {
        kind: "link",
        label: "External",
        target: { url: "https://example.org" },
      },
      { kind: "action", label: "Delete", command: "core.delete" },
      { kind: "text", text: "Hello", style: { color: "red" } },
    ])
      expect(() =>
        validatePluginPanel({ title: "Check", blocks: [block] }, manifest),
      ).toThrow();
    expect(() =>
      validatePluginPanel(
        {
          title: "Check",
          blocks: [
            {
              kind: "field",
              field: { id: "constructor", label: "Unsafe", type: "text" },
            },
          ],
        },
        manifest,
      ),
    ).toThrow();
    expect(() =>
      validatePluginPanel(
        {
          title: "Check",
          blocks: [{ kind: "table", columns: ["A"], rows: [["1", "2"]] }],
        },
        manifest,
      ),
    ).toThrow();
  });
  it("keeps plugin authority separate and restricts proposal methods", () => {
    expect(
      pluginRpcSchema.safeParse({
        grantId: randomUUID(),
        grantRevision: 1,
        packageHash: "a".repeat(64),
        method: "fetch",
        args: { url: "https://example.org" },
      }).success,
    ).toBe(false);
    const a = {
      key: "create",
      action: "file_create",
      spaceId: randomUUID(),
      title: "Test",
      explanation: "",
      dependsOn: [],
      payload: { type: "markdown" },
    };
    expect(pluginActionCapability(a)).toBe("files:propose");
    expect(() =>
      pluginActionCapability({ ...a, payload: { type: "canvas" } }),
    ).toThrow();
    expect(() =>
      pluginActionCapability({ ...a, action: "workspace_purge" }),
    ).toThrow();
  });
  it("ships three valid browser ESM pilots, disabled by policy rather than privileged execution", async () => {
    const packages = await pilotPackages();
    expect(packages).toHaveLength(3);
    for (const p of packages) {
      await expect(
        transform(p.bundle, {
          format: "esm",
          platform: "browser",
          target: "es2022",
        }),
      ).resolves.toBeTruthy();
      expect(p.manifest.capabilities.some((c) => c.includes("network"))).toBe(
        false,
      );
    }
  });
  it("executes the journal, health and planning pilots against bounded host fixtures", async () => {
    const packages = await pilotPackages();
    const run = async (id: string, results: Record<string, unknown>) => {
      const p = packages.find((p) => p.manifest.id === id)!;
      const { default: definition } = await import(
        /* @vite-ignore */ "data:text/javascript;base64," +
          Buffer.from(p.bundle).toString("base64")
      );
      let panel: ReturnType<typeof validatePluginPanel> | undefined;
      await definition.run(
        {
          request: async (method: string) => {
            expect(method in results, method).toBe(true);
            return results[method];
          },
          render: async (raw: unknown) => {
            panel = validatePluginPanel(raw, p.manifest);
          },
        },
        {
          spaceId: randomUUID(),
          resourceId: randomUUID(),
          command: p.manifest.commands[0].id,
          inputs: {},
        },
      );
      return panel!;
    };
    const journal = await run("axiom.journal", {
      "resources.list": { items: [], hasMore: false },
    });
    const journalSource = journal.blocks.find(
      (b) => b.kind === "field" && b.field.id === "source",
    );
    expect(
      journalSource?.kind === "field" && journalSource.field.value,
    ).toContain("\n\n## Today’s focus\n");
    const target = randomUUID(),
      fence = String.fromCharCode(96).repeat(3);
    const health = await run("axiom.document-health", {
      "documents.read": {
        format: "markdown",
        resourceId: randomUUID(),
        hash: "a".repeat(64),
        title: "Study",
        source: [
          "# Study",
          "[[" + target + "|Known note]]",
          "[[Missing]]",
          "[@known]",
          "![ ](image.png)",
          "![](photo.png)",
          fence + "md",
          "[[Not a finding]]",
          fence,
          "{#eq:test}",
          "{#eq:test}",
        ].join("\n"),
      },
      "resources.list": {
        items: [{ id: target, name: "Known note.md" }],
        hasMore: false,
      },
      "references.list": { items: [{ cite_key: "known" }], hasMore: false },
    });
    expect(
      health.blocks.filter((b) => b.kind === "link").map((b) => b.label),
    ).toEqual([
      "Line 3 · Unresolved note: Missing",
      "Line 6 · Image has no description",
      "Line 11 · Repeated figure/equation label: eq:test",
    ]);
    const planning = await run("axiom.planning-brief", {
      "planning.read": {
        version: 4,
        summary: { total: 1, done: 0, blocked: 1, overdue: 0 },
        tasks: [
          {
            title: "Reproduce experiment",
            blocked: true,
            overdue: false,
            status: "todo",
            due_on: null,
          },
        ],
        milestones: [{ title: "Submission", due_on: "2026-12-01" }],
        hasMore: false,
      },
    });
    const report = planning.blocks.find(
      (b) => b.kind === "field" && b.field.id === "source",
    );
    expect(report?.kind === "field" && report.field.value).toContain(
      "\n\n## Summary\n\n- 1 tasks",
    );
    expect(report?.kind === "field" && report.field.value).toContain(
      "Reproduce experiment",
    );
    const oversized = await run("axiom.planning-brief", {
      "planning.read": {
        version: 4,
        summary: { total: 100, done: 0, blocked: 100, overdue: 0 },
        tasks: Array.from({ length: 100 }, () => ({
          title: "Long title ".repeat(50),
          blocked: true,
          status: "todo",
        })),
        milestones: [],
        hasMore: false,
      },
    });
    expect(
      oversized.blocks.some((b) => b.kind === "notice" && b.tone === "warning"),
    ).toBe(true);
  });
  it("uses trusted bootstrap and restrictive inherited worker policy", () => {
    const html = pluginSandboxDocument(
        randomUUID(),
        "http://localhost:3004",
        "testnonce",
      ),
      csp = pluginSandboxCsp("testnonce");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("worker-src blob:");
    expect(csp).not.toContain("unsafe-eval");
    expect(html).toContain("new Worker(url");
    expect(html).not.toContain(bundle);
    expect(html).toContain("event.source!==parent");
  });
});
