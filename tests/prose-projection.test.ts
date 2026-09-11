import { describe, expect, test } from "vitest";
import { projectMarkdown } from "../packages/editor/src/projection";

const project = (source: string, at?: number, head = at) =>
  projectMarkdown(source, {
    proseSource: true,
    reveal: at !== undefined,
    selection: at === undefined ? undefined : { anchor: at, head: head! },
  });
const sourceUnits = (source: string, at: number) =>
  project(source, at).activeProse.map((range) =>
    source.slice(range.from, range.to),
  );

describe("source while editing", () => {
  test.each([
    "#",
    "# ",
    "# Title",
    "### A **result** ###",
    "- item",
    "1. item",
    "12) item",
    "- [ ] task",
    "+ [x] done",
    "**all** and _inline_ [source](/paper)",
  ])("the active unit includes every authored character: %s", (source) => {
    for (let at = 0; at <= source.length; at++) {
      const projection = project(source, at);
      expect(projection.doc.firstChild!.type.name).toBe("source_prose");
      expect(projection.doc.textContent).toBe(source);
      expect(projection.map.sourceAt(projection.map.positionAt(at))).toBe(at);
      expect(projection.doc.check()).toBeUndefined();
    }
  });
  test("leaving a heading renders it; revisiting reveals the same source", () => {
    const source = "# Exact **heading** ###\n\nAfter";
    expect(project(source, 5).doc.firstChild!.textContent).toBe(
      "# Exact **heading** ###",
    );
    expect(project(source, source.length).doc.firstChild!.type.name).toBe(
      "heading",
    );
    expect(project(source).doc.firstChild!.textContent).toBe("Exact heading");
    expect(sourceUnits(source, 5)).toEqual(["# Exact **heading** ###"]);
  });
  test.each([1, 2, 3, 4, 5, 6])(
    "active H%i keeps semantic heading typography and every editable hash",
    (level) => {
      const source = "#".repeat(level) + " A **result** ###";
      for (let at = 0; at <= source.length; at++) {
        const projection = project(source, at);
        const heading = projection.doc.firstChild!;
        expect(heading.attrs).toEqual({ kind: "heading", level });
        expect(heading.type.spec.toDOM!(heading)).toEqual([
          "h" + level,
          { class: "axiom-source-prose", "data-source-kind": "heading" },
          0,
        ]);
        expect(heading.textContent).toBe(source);
        expect(projection.map.sourceAt(projection.map.positionAt(at))).toBe(at);
        expect(projection.parsed.outline[0].level).toBe(level);
        expect(projection.parsed.outline[0].text).toBe("A result");
      }
    },
  );
  test.each(["- ### Nested"])(
    "container headings retain their level without hiding prefixes: %s",
    (source) => {
      const projection = project(source, source.length);
      expect(projection.doc.firstChild!.attrs).toEqual({
        kind: "heading",
        level: 3,
      });
      expect(projection.doc.textContent).toBe(source);
    },
  );
  test.each(["#hashtag", "####### Plain", "\\# Escaped", "`# Code`"])(
    "non-headings retain ordinary paragraph typography: %s",
    (source) => {
      const node = project(source, source.length).doc.firstChild!;
      expect(node.attrs.level).toBe(0);
      expect(node.type.spec.toDOM!(node)).toHaveProperty("0", "p");
      expect(node.textContent).toBe(source);
    },
  );
  test("setext headings retain their authored underline, never synthesize hashes", () => {
    const source = "Exact title\n===========\n\nAfter";
    const heading = project(source, 5).doc.firstChild!;
    expect(heading.attrs).toEqual({ kind: "heading", level: 1 });
    expect(heading.textContent).toBe("Exact title\n===========");
  });
  test.each(["-", "1.", "*", "- ", ">"])(
    "an unfinished prefix before existing text has no hidden caret: %s",
    (prefix) => {
      const source = prefix + "\n\nOutside";
      const projection = project(source, prefix.length);
      expect(projection.doc.firstChild!.textContent).toBe(prefix);
      expect(
        projection.map.sourceAt(projection.map.positionAt(prefix.length)),
      ).toBe(prefix.length);
    },
  );
  test("a list item reveals its own prose without revealing siblings or nested items", () => {
    const source = "1. first\n\n   continuation\n   - nested\n2. second\n";
    expect(sourceUnits(source, source.indexOf("first"))).toEqual([
      "1. first\n\n   continuation",
    ]);
    expect(sourceUnits(source, source.indexOf("nested"))).toEqual([
      "   - nested",
    ]);
    expect(project(source, source.indexOf("nested")).doc.textContent).toContain(
      "first",
    );
    expect(
      project(source, source.indexOf("nested")).doc.textContent,
    ).not.toContain("1. first");
  });
  test("a quote paragraph maps an empty continuation body without showing its prefix", () => {
    const source = "> first\n> \n> second\n> ";
    expect(sourceUnits(source, source.length)).toEqual(["second\n> "]);
    expect(
      project(source, source.length).doc.lastChild!.lastChild!.textContent,
    ).toBe("second\n");
    expect(project(source, source.length).doc.textContent).toContain("first");
    expect(project(source, source.length).doc.textContent).not.toContain(
      "> first",
    );
  });
  test.each(["[TOC]", "---\ntitle: Example\n---", "[ref]: /paper 'Title'"])(
    "other structural blocks remain source editable: %s",
    (source) => {
      expect(sourceUnits(source, Math.floor(source.length / 2))).toEqual([
        source,
      ]);
    },
  );
  test.each(["---", "***", "___", "* * *", "> ***", "  ***\r\n"])(
    "dividers never become active source prose: %s",
    (source) => {
      for (let at = 0; at <= source.length; at++) {
        const projection = project(source, at);
        expect(projection.activeProse).toEqual([]);
        expect(
          projection.blocks.some((block) => block.node.type === "hr"),
        ).toBe(true);
        expect(projection.doc.check()).toBeUndefined();
      }
    },
  );
  test("callout headers occur once in the active source mapping", () => {
    const source = "> [!NOTE] Title\n> Body\n";
    expect(sourceUnits(source, 8)).toEqual(["[!NOTE] Title\n> Body"]);
    expect(project(source, 8).doc.textContent).toBe("[!NOTE] Title\nBody");
  });
  test.each([
    ["```js\nx=1\n```", 8, "embedded"],
    ["$$\nx=1\n$$", 4, "embedded"],
    ["| A |\n| --- |\n| B |", 16, "table"],
  ] as const)(
    "specialized blocks keep their surface: %s",
    (source, at, kind) => {
      const projection = project(source, at);
      expect(projection.doc.firstChild!.type.name).toBe(kind);
      expect(projection.activeProse).toEqual([]);
    },
  );
  test("CRLF source has an exact map with normalized display line endings", () => {
    const source = "> **first**\r\n> second\r\n";
    const projection = project(source, 15);
    expect(projection.doc.firstChild!.textContent).toBe("**first**\nsecond");
    for (let at = 0; at < source.length - 2; at++) {
      if (source[at - 1] === "\r") continue;
      if (at < 2 || (at >= 13 && at < 15)) continue; // Hidden quote markers.
      expect(projection.map.sourceAt(projection.map.positionAt(at))).toBe(at);
    }
  });
  test("extended selections reveal endpoint prose without consuming embedded blocks", () => {
    const source = "# Heading\n\n```js\nx\n```\n\n> Quote";
    expect(sourceUnits(source, 0)).toEqual(["# Heading"]);
    const projection = project(source, source.length, 0);
    expect(projection.activeProse).toHaveLength(2);
    expect(
      projection.doc
        .toJSON()
        .content.some((node: { type: string }) => node.type === "embedded"),
    ).toBe(true);
  });
});

describe("visible empty paragraphs", () => {
  test.each([0, 1, 2, 3, 6])(
    "%i Enter presses add that many paragraphs and mapped caret stops",
    (count) => {
      const source = "\n\n".repeat(count);
      const projection = project(source, source.length);
      expect(projection.doc.childCount).toBe(count + 1);
      expect(projection.map.spans.map((span) => span.sourceFrom)).toEqual(
        Array.from({ length: count + 1 }, (_, i) => i * 2),
      );
    },
  );
  test.each([
    "\n\nfirst",
    "first\n\n\n\nlast",
    "first\n\n\n\n",
    "\r\n\r\nfirst",
    "first\r\n\r\n\r\n\r\nlast",
  ])(
    "leading, middle and trailing blank paragraphs have source positions: %s",
    (source) => {
      const projection = project(source);
      const blanks = projection.blocks.filter(
        (block) => block.node.type === "blankParagraph",
      );
      expect(blanks.length).toBeGreaterThan(0);
      for (const block of blanks) {
        const at = block.node.from;
        expect(projection.map.sourceAt(projection.map.positionAt(at))).toBe(at);
      }
    },
  );
  test("ordinary paragraph separators do not insert an extra blank paragraph", () => {
    expect(project("one\n\ntwo").doc.childCount).toBe(2);
  });
  test("whitespace typing retains one paragraph, not a phantom EOF paragraph", () => {
    expect(project("   ", 3).doc.childCount).toBe(1);
    expect(project("   ", 3).doc.textContent).toBe("   ");
  });
  test.each(["alpha  \n", "alpha\\\n", "alpha  \r\n"])(
    "a pending hard break remains within the same paragraph: %s",
    (source) => {
      expect(project(source, source.length).doc.childCount).toBe(1);
      expect(project(source, source.length).doc.textContent).toBe(
        source.replaceAll("\r\n", "\n"),
      );
      expect(project(source).doc.childCount).toBe(1);
      expect(project(source).doc.textContent).toBe("alpha\n");
    },
  );
  test("an escaped backslash is retained before a pending hard break", () => {
    expect(project("alpha\\\\\\\n").doc.textContent).toBe("alpha\\\n");
    expect(project("alpha\\\\\n").doc.textContent).toBe("alpha\\");
  });
});
