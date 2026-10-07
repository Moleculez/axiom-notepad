import { describe, expect, it } from "vitest";
import {
  parseMarkdown,
  parseMarkdownFragment,
  renderDocument,
  type MathRequest,
  type ParsedDocument,
} from "../packages/markdown/src";

const frozen = <T extends object>(value: T): T => {
  for (const entry of Object.values(value))
    if (entry && typeof entry === "object" && !Object.isFrozen(entry))
      frozen(entry);
  return Object.freeze(value);
};
const render = (source: string, owner: ParsedDocument) =>
  renderDocument(parseMarkdownFragment(source, owner), {
    document: owner,
    fragment: true,
  });

describe("document-scoped Markdown fragments", () => {
  it("resolves full, collapsed and shortcut references from immutable owner definitions", () => {
    const owner = frozen(
      parseMarkdown(
        '# Owner\n\n[Paper]: https://example.test/first "Title"\n[paper]: https://example.test/ignored\n[Study figure]: figure.png\n',
      ),
    );
    const before = JSON.stringify(owner);
    const fragment = parseMarkdownFragment(
      "[Paper] [Paper][] [alias][PAPER] ![Plot][study   figure]",
      owner,
    );
    const html = renderDocument(fragment, { document: owner, fragment: true });
    expect(html.match(/href="https:\/\/example.test\/first"/g)).toHaveLength(3);
    expect(html).toContain('title="Title"');
    expect(html).toContain('<img src="figure.png" alt="Plot"');
    expect(html).not.toContain("ignored");
    expect(fragment.ast.from).toBe(0);
    expect(fragment.links[0].from).toBe(0);
    expect(fragment.definitions).toEqual([]);
    expect(JSON.stringify(owner)).toBe(before);
  });

  it("recognizes inherited footnotes without visiting or mutating their AST", () => {
    const owner = frozen(
      parseMarkdown(
        "Text[^detail].\n\n[^detail]: **Details** [Paper]\n\n[Paper]: https://example.test\n",
      ),
    );
    const before = JSON.stringify(owner),
      fragment = parseMarkdownFragment("Here[^detail].", owner);
    expect(fragment.footnotes.detail).toBe(owner.footnotes.detail);
    expect(
      renderDocument(fragment, { document: owner, fragment: true }),
    ).toContain('data-footnote-key="detail"');
    expect(fragment.links).toEqual([]);
    expect(JSON.stringify(owner)).toBe(before);
  });

  it("parses local footnote bodies separately without overwriting owner definitions", () => {
    const owner = frozen(parseMarkdown("[^detail]: Original\n"));
    const fragment = parseMarkdownFragment(
      "Reference[^detail].\n\n[^detail]: *Local*\n",
      owner,
    );
    expect(fragment.footnotes.detail).not.toBe(owner.footnotes.detail);
    expect(fragment.footnotes.detail[0].children?.[0].type).toBe("em");
    expect(owner.footnotes.detail[0].text).toBe("Original");
  });

  it("uses owner equation macros, references and global citation numbers", () => {
    const owner = frozen(
      parseMarkdown(
        "# Research\n\n$$\n\\newcommand{\\R}{\\mathbb{R}}\nx \\label{first}\n$$\n\n[@alpha]\n\n[@beta]\n",
      ),
    );
    const requests: MathRequest[] = [];
    const html = renderDocument(
      parseMarkdownFragment(
        "$$\ny=\\R + \\eqref{first}\n$$\n\n[@beta]\n",
        owner,
      ),
      {
        document: owner,
        fragment: true,
        math: (request) => {
          requests.push(request);
          return "";
        },
      },
    );
    expect(requests[0].macros).toEqual(["\\newcommand{\\R}{\\mathbb{R}}"]);
    expect(requests[0].tex).toContain("\\text{(1)}");
    expect(html).toContain(
      'href="#ref-beta" title="Unresolved citation: beta">[2]</a>',
    );
    expect(html).not.toContain('class="references"');
  });

  it("refreshes inherited destinations when only outside definitions change", () => {
    const excerpt = "[same][ref]";
    const first = parseMarkdown(
        excerpt + "\n\n[ref]: https://example.test/first\n",
      ),
      second = parseMarkdown(
        excerpt + "\n\n[ref]: https://example.test/second\n",
      );
    expect(render(excerpt, first)).toContain("https://example.test/first");
    expect(render(excerpt, second)).toContain("https://example.test/second");
  });
});
