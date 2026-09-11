import { describe, expect, test } from "vitest";
import {
  documentIndex,
  MarkdownEngine,
  parseMarkdown,
  renderDocument,
  type MarkdownNode,
} from "../packages/markdown/src";
import { literalBody } from "../packages/editor/src/literal";
import { projectMarkdown } from "../packages/editor/src/projection";
import { applyChanges, enterEdit } from "../packages/editor/src/transactions";
import { preserveLineEndings } from "../packages/editor/src/line-endings";
import { editorDefaults } from "../packages/shared/src/editor";

const math = (
  source: string,
  dialect: "stem-v1" | "gfm" | "commonmark" = "stem-v1",
) => {
  const found: MarkdownNode[] = [];
  const visit = (node: MarkdownNode) => {
    if (node.type === "mathInline" || node.type === "mathBlock")
      found.push(node);
    node.children?.forEach(visit);
  };
  visit(parseMarkdown(source, dialect).ast);
  return found;
};
const tick = String.fromCharCode(96);

describe("source-exact TeX delimiters", () => {
  test.each([
    "\\(x+1\\)",
    "Before \\(x+1\\) after",
    "**Result:** \\(x+1\\)",
    "| A |\n| --- |\n| \\(x+1\\) |",
  ])("inline math renders without delimiters: %j", (source) => {
    const found = math(source);
    expect(found).toHaveLength(1);
    expect(found[0].type).toBe("mathInline");
    expect(found[0].text).toBe("x+1");
    expect(source.slice(found[0].from, found[0].to)).toBe("\\(x+1\\)");
    expect(source.slice(found[0].contentFrom, found[0].contentTo)).toBe("x+1");
    const html = renderDocument(parseMarkdown(source));
    expect(html).toContain("math-inline");
    expect(html).toContain("&quot;display&quot;:false");
  });
  test.each(["", "> ", "> > ", "- ", "> - ", "- > ", "> [!NOTE]\n> "])(
    "inline and display mathematics keep nested source offsets: %j",
    (prefix) => {
      const source = prefix + "\\[x=2\\]\n\nEnd \\(x+1\\)";
      const found = math(source);
      expect(found.map((n) => [n.type, n.text])).toEqual([
        ["mathBlock", "x=2"],
        ["mathInline", "x+1"],
      ]);
      expect(literalBody(source, found[0]).text).toBe("x=2");
      expect(source.slice(found[0].contentFrom, found[0].contentTo)).toBe(
        "x=2",
      );
      const projection = projectMarkdown(source, {
        proseSource: true,
        reveal: true,
        selection: { anchor: source.length, head: source.length },
      });
      projection.doc.check();
      expect(
        projection.blocks.filter((b) => b.node.type === "mathBlock"),
      ).toHaveLength(1);
    },
  );
  for (const ending of ["\n", "\r\n"]) {
    test.each(["", "> ", "> > ", "  > "])(
      "fenced math interrupts prose and preserves physical endings " +
        JSON.stringify(ending) +
        " %j",
      (prefix) => {
        const source = ["Before", "\\[", "x=2", "y=3", "\\]", "After"]
          .map((s) => prefix + s)
          .join(ending);
        const found = math(source);
        expect(found).toHaveLength(1);
        expect(found[0].text).toBe("x=2\ny=3");
        const body = literalBody(source, found[0]);
        expect(body.text).toBe("x=2\ny=3");
        for (const [i, char] of [...body.text].entries())
          if (char !== "\n") expect(source[body.offsets[i]]).toBe(char);
        const html = renderDocument(parseMarkdown(source));
        expect(html).toContain("<p>Before</p>");
        expect(html).toContain("<p>After</p>");
        expect(html).toContain("&quot;display&quot;:true");
      },
    );
    test(
      "inline soft breaks preserve source coordinates " +
        JSON.stringify(ending),
      () => {
        const source = "> Before \\(x +" + ending + "> y\\) after";
        const node = math(source)[0];
        expect(node.text).toBe("x +\ny");
        expect(source.slice(node.from, node.to)).toBe(
          "\\(x +" + ending + "> y\\)",
        );
        const projection = projectMarkdown(source, {
          proseSource: true,
          reveal: true,
          selection: { anchor: 12, head: 12 },
        });
        projection.doc.check();
        expect(projection.map.sourceAt(projection.map.positionAt(12))).toBe(12);
      },
    );
  }
  test.each([
    "\\[",
    "\\(x",
    "\\[x\\)",
    "\\(x\\]",
    "\\[\nx\n$$",
    "$$\nx\n\\]",
    "\\\\[x\\\\]",
    "\\\\(x\\\\)",
    "\\(x\\\\)",
    "\\[x\\\\]",
    tick + "\\(x\\)" + tick,
    tick.repeat(3) + "tex\n\\[\nx\n\\]\n\\(y\\)\n" + tick.repeat(3),
    "    \\[x\\]",
    "    \\(x\\)",
    "> \\[\n> x\n\\]",
    "> \\[\nx\n> \\]",
    "> > \\[\n> > x\n> \\]",
    "> - \\[\n>   x\n> - \\]",
    "\\(x\n\ny\\)",
  ])(
    "incomplete, escaped, code and cross-container syntax stays non-math: %j",
    (source) => {
      expect(math(source)).toEqual([]);
      expect(renderDocument(parseMarkdown(source))).not.toContain(
        "data-math-request",
      );
    },
  );
  test("escaped closers and TeX row breaks remain in the equation body", () => {
    expect(math("\\(x\\\\) + y\\)")[0].text).toBe("x\\\\) + y");
    expect(math("\\[x\\\\] + y\\]")[0].text).toBe("x\\\\] + y");
    expect(
      math("\\[\n\\begin{aligned}x&=1\\\\y&=2\\end{aligned}\n\\]")[0].text,
    ).toContain("1\\\\y");
  });
  test("dollar forms, labels and references coexist without normalization", () => {
    const source =
      "\\[x\\label{first}\\]\n\n$$y\\label{second}$$\n\n\\(x\\) and $y$; \\eqref{first}.";
    const document = parseMarkdown(source);
    expect(math(source).map((n) => n.type)).toEqual([
      "mathBlock",
      "mathBlock",
      "mathInline",
      "mathInline",
    ]);
    expect([...documentIndex(document).labels]).toEqual([
      ["first", 1],
      ["second", 2],
    ]);
    const engine = new MarkdownEngine();
    for (let at = 0; at <= source.length; at++)
      expect(engine.parse(source.slice(0, at))).toEqual(
        parseMarkdown(source.slice(0, at)),
      );
  });
  test.each(["gfm", "commonmark"] as const)(
    "leaves %s Markdown escapes unchanged",
    (dialect) => {
      const source = "\\[x\\]\n\n\\(y\\)";
      expect(math(source, dialect)).toEqual([]);
      const html = renderDocument(parseMarkdown(source, dialect));
      expect(html).toContain("[x]");
      expect(html).toContain("(y)");
    },
  );
  test("many unmatched delimiters do not repeatedly scan the document suffix", () => {
    const source = "\\[\n".repeat(8000) + "\\(".repeat(8000);
    const started = performance.now();
    expect(math(source)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe("TeX fence Enter", () => {
  for (const ending of ["\n", "\r\n"])
    test.each([
      ["", ""],
      ["> ", "> "],
      ["> > ", "> > "],
      ["> - ", ">   "],
      ["- > ", "  > "],
    ])(
      "pairs bracket delimiters inside the current container " +
        JSON.stringify(ending) +
        " %j",
      (opener, continuation) => {
        const before = "Before" + ending.repeat(2),
          source = before + opener + "\\[",
          selection = { anchor: source.length, head: source.length };
        const edit = preserveLineEndings(source, selection, (text, at) =>
          enterEdit(text, at, editorDefaults, false, true),
        );
        const result = applyChanges(source, edit.changes);
        expect(result).toBe(
          source +
            ending +
            continuation +
            ending +
            continuation +
            "\\]" +
            ending +
            (continuation || ending),
        );
        expect(math(result)).toHaveLength(1);
        expect(edit.selection.anchor).toBe(
          source.length + ending.length + continuation.length,
        );
      },
    );
});
