import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
  readArchive,
  rewriteLinks,
  localTarget,
} from "../packages/shared/src/archive";
import {
  parseMarkdown,
  type MarkdownNode,
} from "../packages/markdown/src/index";

describe("source-preserving portability", () => {
  it("rewrites links in callouts, tasks and tables without touching examples", () => {
    const source =
      "> [!NOTE]\n> See [[Target]].\n\n- [ ] [[Target]]\n\n| Note |\n| --- |\n| [[Target]] |\n\n`[[Target]]`\n\n```md\n[[Target]]\n```\n";
    const result = rewriteLinks(source, (n) =>
      n.href === "Target" ? "target.md" : undefined,
    );
    expect(result.match(/\[Target\]\(<target.md>\)/g)).toHaveLength(3);
    expect(result).toContain("`[[Target]]`");
    expect(result).toContain("```md\n[[Target]]\n```");
    expect(result).toContain("> See [Target]");
    expect(result).toContain("- [ ] [Target]");
  });
  it("maps nested STEM source positions back to exact delimiters", () => {
    const source =
      "> [!PROOF]\n> **Claim** and $x^2$.\n\n- [ ] See [@a2026].\n\n| Expression |\n| --- |\n| $a\\|b$ |\n";
    const ast = parseMarkdown(source).ast,
      spans: string[] = [];
    const visit = (n: MarkdownNode) => {
      if (["strong", "mathInline", "citation"].includes(n.type))
        spans.push(source.slice(n.from, n.to));
      n.children?.forEach(visit);
    };
    visit(ast);
    expect(spans).toEqual(["**Claim**", "$x^2$", "[@a2026]", "$a\\|b$"]);
  });
  it("resolves safe sibling paths but not external or escaping paths", () => {
    expect(localTarget("notes/a.md", "../attachments/a.pdf#page=3")).toEqual({
      path: "attachments/a.pdf",
      fragment: "#page=3",
    });
    for (const target of [
      "../../secret",
      "https://example.com/a",
      "/etc/passwd",
      "%2e%2e/%2e%2e/secret",
    ])
      expect(localTarget("notes/a.md", target)).toBeNull();
  });
  it("previews a complete archive with hierarchy, attachments and BibTeX", async () => {
    const zip = new JSZip();
    zip.file(
      "notes/a.md",
      "# Claim\n\n[Proof](b.md)\n\n[Paper](../attachments/paper.pdf#page=1)",
    );
    zip.file("notes/b.md", "Proof.");
    zip.file("attachments/paper.pdf", "%PDF-1.7\nexample");
    zip.file(
      "references.bib",
      "@article{a2026,title={A useful result},author={A. Researcher},year={2026}}",
    );
    zip.file(
      "manifest.json",
      JSON.stringify({
        format: "axiom-notebook",
        version: 1,
        notes: [
          { id: "a", file: "notes/a.md", title: "Claim", tags: ["math"] },
          { id: "b", file: "notes/b.md", title: "Proof", parentId: "a" },
        ],
      }),
    );
    const plan = await readArchive(
      "notes.zip",
      await zip.generateAsync({ type: "uint8array" }),
    );
    expect(plan.notes).toHaveLength(2);
    expect(plan.notes[1].parentId).toBe("a");
    expect(plan.attachments[0].mime).toBe("application/pdf");
    expect(plan.references[0].citeKey).toBe("a2026");
    expect(plan.warnings).toEqual([]);
  });
  it("rejects path traversal and cyclic hierarchies", async () => {
    const zip = new JSZip();
    zip.file("../escape.md", "no");
    await expect(
      readArchive("bad.zip", await zip.generateAsync({ type: "uint8array" })),
    ).rejects.toThrow("Unsafe archive path");
    const cycle = new JSZip();
    cycle.file("a.md", "a");
    cycle.file("b.md", "b");
    cycle.file(
      "manifest.json",
      JSON.stringify({
        format: "axiom-notebook",
        version: 1,
        notes: [
          { id: "a", file: "a.md", title: "a", parentId: "b" },
          { id: "b", file: "b.md", title: "b", parentId: "a" },
        ],
      }),
    );
    await expect(
      readArchive(
        "cycle.zip",
        await cycle.generateAsync({ type: "uint8array" }),
      ),
    ).rejects.toThrow("cyclic");
  });
  it("rejects mismatched checksums and invalid UTF-8", async () => {
    await expect(readArchive("bad.md", new Uint8Array([255]))).rejects.toThrow(
      "UTF-8",
    );
    const zip = new JSZip();
    zip.file("a.md", "# A");
    zip.file("a.pdf", "%PDF-1.7");
    zip.file(
      "manifest.json",
      JSON.stringify({
        format: "axiom-notebook",
        version: 1,
        notes: [{ id: "a", file: "a.md", title: "A" }],
        attachments: [
          { file: "a.pdf", noteId: "a", name: "a.pdf", sha256: "wrong" },
        ],
      }),
    );
    await expect(
      readArchive("bad.zip", await zip.generateAsync({ type: "uint8array" })),
    ).rejects.toThrow("checksum");
  });
});
