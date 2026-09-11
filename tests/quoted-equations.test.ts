import { describe, expect, test } from "vitest";
import {
  containerText,
  MarkdownEngine,
  parseMarkdown,
  quoteContext,
  renderDocument,
  sourceCommand,
  type MarkdownNode,
} from "../packages/markdown/src/index";
import { literalBody, literalPrefix } from "../packages/editor/src/literal";
import { applyChanges, enterEdit } from "../packages/editor/src/transactions";
import { preserveLineEndings } from "../packages/editor/src/line-endings";
import { projectMarkdown } from "../packages/editor/src/projection";
import { editorDefaults } from "../packages/shared/src/editor";

const equations = (
  source: string,
  dialect: "stem-v1" | "gfm" | "commonmark" = "stem-v1",
) => {
  const found: MarkdownNode[] = [];
  const visit = (n: MarkdownNode) => {
    if (n.type === "mathBlock") found.push(n);
    n.children?.forEach(visit);
  };
  visit(parseMarkdown(source, dialect).ast);
  return found;
};
const project = (source: string, at: number) =>
  projectMarkdown(source, {
    proseSource: true,
    reveal: true,
    selection: { anchor: at, head: at },
  });
const command = (id: string, source: string, at: number, to = at) => {
  const edit = sourceCommand(id, source, at, to)!;
  expect(edit).not.toBeNull();
  return {
    source: applyChanges(source, edit.changes),
    at: edit.selection.anchor,
    head: edit.selection.head ?? edit.selection.anchor,
    edit,
  };
};

describe("container-local display math", () => {
  test.each(["", "> ", "> > ", ">   ", "  > "])(
    "equations interrupt prose without blank separators: %j",
    (prefix) => {
      const source = ["Before", "$$", "E=mc^2", "$$", "After"]
        .map((s) => prefix + s)
        .join("\n");
      const found = equations(source);
      expect(found).toHaveLength(1);
      expect(found[0].text).toBe(prefix === ">   " ? "  E=mc^2" : "E=mc^2");
      const html = renderDocument(parseMarkdown(source));
      expect(html).toContain("data-math-request");
      expect(html).toContain("<p>Before</p>");
      expect(html).toContain("<p>After</p>");
      const p = project(source, source.indexOf("Before") + 3);
      expect(p.blocks.filter((n) => n.node.type === "mathBlock")).toHaveLength(
        1,
      );
      expect(p.activeProse.map((n) => source.slice(n.from, n.to))).toEqual([
        (prefix === ">   " ? "  " : "") + "Before",
      ]);
    },
  );
  test.each([
    "> [!THEOREM] Energy\n> Before\n> $$\n> E=mc^2\n> $$\n> After",
    "> - Before\n>   $$\n>   E=mc^2\n>   $$\n>   After\n> - Next",
    "- > Before\n  > $$\n  > E=mc^2\n  > $$\n  > After\n- Next",
    "> > Before\n> > $$\n> > E=mc^2\n> > $$\n> After",
    "> Before\n> $$E=mc^2$$\n> After",
    "> Before\n>\n> $$\n> E=mc^2\n> $$\n>\n> After",
  ])(
    "quote/callout/list rendering and literal source offsets: %j",
    (source) => {
      const math = equations(source);
      expect(math).toHaveLength(1);
      const body = literalBody(source, math[0]);
      expect(body.text).toBe("E=mc^2");
      expect(body.offsets).toEqual(
        Array.from({ length: 7 }, (_, i) => source.indexOf("E=") + i),
      );
      expect(renderDocument(parseMarkdown(source))).toContain(
        "data-math-request",
      );
      project(source, source.length).doc.check();
    },
  );
  test.each([
    "> Before\n> $$\n> x",
    "> $$\n> x\n$$",
    "> $$\nx\n> $$",
    "> > $$\n> > x\n> $$",
    "> $$\n> x\n\nOutside\n$$",
    "> - $$\n>   x\n> - $$",
    "> `$$x$$`",
    "> ```tex\n> $$\n> x\n> $$\n> ```",
    "> \\$\\$\n> x\n> \\$\\$",
  ])(
    "unfinished, escaped, code, and cross-container fences stay literal: %j",
    (source) => {
      expect(equations(source)).toHaveLength(0);
      expect(renderDocument(parseMarkdown(source))).not.toContain(
        "data-math-request",
      );
    },
  );
  test.each(["gfm", "commonmark"] as const)(
    "the %s dialect is unchanged",
    (dialect) => {
      expect(
        equations("> Before\n> $$\n> E=mc^2\n> $$\n> After", dialect),
      ).toHaveLength(0);
    },
  );
  test("incremental parsing agrees with full parsing while fences and prefixes change", () => {
    const engine = new MarkdownEngine();
    for (const s of [
      "> Before",
      "> Before\n> $$",
      "> Before\n> $$\n> x\n> $$",
      "> Before\n> $$\n> xyz\n> $$",
      "> Before\n> $$\n> xyz\n$$",
      "> Before\n> $$\n> xyz\n> $$\n> After",
    ])
      expect(engine.parse(s)).toEqual(parseMarkdown(s));
  });
});

describe("quoted equation source commands and caret projection", () => {
  test.each(["> ", "> > ", "> - ", "> 1. ", "- > ", "> [!NOTE]\n> "])(
    "insert, finish, and edit in the same quote/list: %j",
    (initial) => {
      const start = command("mathBlock", initial, initial.length);
      const math = equations(start.source)[0];
      expect(math).toBeDefined();
      const prefix = literalPrefix(start.source, math);
      expect(start.at).toBe(literalBody(start.source, math).offsets[0]);
      const typed = applyChanges(start.source, [
        { from: start.at, to: start.at, insert: "E=mc^2" },
      ]);
      const finish = command("finishBlock", typed, start.at + 6);
      expect(finish.source).toBe(typed); // Reuse the empty paragraph inserted with the equation.
      expect(finish.source.slice(0, finish.at).endsWith("$$\n" + prefix)).toBe(
        true,
      );
      const projection = project(finish.source, finish.at);
      expect(
        projection.map.sourceAt(projection.map.positionAt(finish.at)),
      ).toBe(finish.at);
      expect(
        projection.activeProse.map((r) => finish.source.slice(r.from, r.to)),
      ).toEqual([prefix.replace(/^(?: {0,3}>[ \t]?)+/, "")]);
      expect(
        projection.blocks.filter((b) => b.node.type === "mathBlock"),
      ).toHaveLength(1);
      projection.doc.check();
      const before = command("paragraphBefore", typed, start.at);
      expect(equations(before.source)).toHaveLength(1);
      expect(quoteContext(before.source, before.at)?.key).toBe(
        quoteContext(before.source, equations(before.source)[0].from)?.key,
      );
      const beforeProjection = project(before.source, before.at);
      expect(
        beforeProjection.map.sourceAt(
          beforeProjection.map.positionAt(before.at),
        ),
      ).toBe(before.at);
      beforeProjection.doc.check();
    },
  );
  test.each(["\n", "\r\n"])(
    "typed $$ Enter and Command Enter preserve %j endings",
    (ending) => {
      const source = "> Before" + ending + "> > $$";
      const selection = { anchor: source.length, head: source.length };
      const edit = preserveLineEndings(source, selection, (s, pos) =>
        enterEdit(s, pos, editorDefaults),
      );
      const next = applyChanges(source, edit.changes);
      expect(next).toBe(
        source + ending + "> > " + ending + "> > $$" + ending + "> > ",
      );
      expect(edit.selection.anchor).toBe(source.length + ending.length + 4);
      const finish = command("finishBlock", next, edit.selection.anchor);
      expect(finish.source).toBe(next);
      expect(finish.at).toBe(next.length);
    },
  );
  test.each(["\n", "\r\n"])(
    "selecting quoted prose only unwraps quote prefixes (%j)",
    (ending) => {
      const source = ["> Intro", "> alpha", "> beta", "> After"].join(ending);
      const start = source.indexOf("alpha"),
        end = source.indexOf("beta") + 4;
      const converted = command("mathBlock", source, start, end);
      expect(converted.source).toBe(
        ["> Intro", "> $$", "> alpha", "> beta", "> $$", "> ", "> After"].join(
          ending,
        ),
      );
      expect(
        literalBody(converted.source, equations(converted.source)[0]).text,
      ).toBe("alpha\nbeta");
      expect(converted.source.slice(converted.at, converted.head)).toBe(
        "alpha" + ending + "> beta",
      );
    },
  );
  test.each([
    "> first\n\nOutside",
    "> outer\n> > inner\n> outer",
    "> - first\n> - second",
    "> first\n\n> second",
    "Before\n\n> Quoted\n\nAfter",
  ])("cross-container selections do not change source: %j", (source) => {
    expect(sourceCommand("mathBlock", source, 2, source.length)).toBeNull();
  });
  test("finishing an existing equation before prose adds a local paragraph", () => {
    const source = "> $$\n> x\n> $$\n> After\n\nOutside";
    const finish = command("finishBlock", source, source.indexOf("x"));
    expect(finish.source).toBe(source.replace("> After", "> \n> After"));
    expect(finish.at).toBe(finish.source.indexOf("> \n> After") + 2);
    expect(
      project(finish.source, finish.at).map.sourceAt(
        project(finish.source, finish.at).map.positionAt(finish.at),
      ),
    ).toBe(finish.at);
  });
  test("lazy nested prose gains explicit quote depth on inserted lines", () => {
    const source = "> > first\n> lazy";
    const inserted = command("mathBlock", source, source.length);
    expect(inserted.source).toBe(source + "\n> > $$\n> > \n> > $$\n> > ");
    expect(equations(inserted.source)).toHaveLength(1);
  });
  test.each(["> alpha\n>   beta", "> - alpha\n>     beta"])(
    "selected TeX indentation is not confused with container prefixes: %j",
    (source) => {
      const inserted = command(
        "mathBlock",
        source,
        source.indexOf("alpha"),
        source.length,
      );
      expect(equations(inserted.source)[0].text).toBe("alpha\n  beta");
    },
  );
});

describe("TeX prefix and newline mapping", () => {
  test.each(["\n", "\r\n"])(
    "literal bodies retain every TeX character through %j",
    (ending) => {
      const source = ["> > $$", "> > a + b", "> > ", "> >   c ", "> > $$"].join(
        ending,
      );
      const body = literalBody(source, equations(source)[0]);
      expect(body.text).toBe("a + b\n\n  c ");
      expect(body.offsets).toHaveLength(body.text.length + 1);
      for (let i = 0; i < body.text.length; i++)
        expect(source[body.offsets[i]]).toBe(
          body.text[i] === "\n" && ending === "\r\n" ? "\r" : body.text[i],
        );
      expect(body.offsets.at(-1)).toBe(source.indexOf("  c ") + 4);
    },
  );
  test("snippet offsets are mapped once, including CRLF and Unicode", () => {
    for (const value of ["a\nb\nc", "a\r\nb\r\nc", "α\n😀\n", "\n"]) {
      const result = containerText(value, "> > ", "\r\n");
      expect(result.text).toBe(value.replace(/\r?\n/g, "\r\n> > "));
      expect(result.offsets).toHaveLength(value.length + 1);
      expect(result.offsets.at(-1)).toBe(result.text.length);
      for (let i = 0; i < value.length; i++)
        if (!/[\r\n]/.test(value[i]))
          expect(result.text[result.offsets[i]]).toBe(value[i]);
    }
  });
  test("a long unmatched fence scan remains bounded", () => {
    const source = "> Before\n" + "> $$ pending\n".repeat(5000) + "> $$";
    const now = performance.now();
    expect(equations(source)).toHaveLength(0);
    expect(performance.now() - now).toBeLessThan(2000);
  });
});
