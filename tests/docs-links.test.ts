import { describe, expect, it } from "vitest";
import { documentationLinks } from "../scripts/verify/doc-links";

describe("documentation link inventory", () => {
  it("finds Markdown links and images with source lines", () => {
    expect(
      documentationLinks(
        '# Guide\n\n[Read](guide.md "Title")\n![Demo](image.png)',
      ),
    ).toEqual([
      { target: "guide.md", line: 3 },
      { target: "image.png", line: 4 },
    ]);
  });
  it("checks angle-bracket paths with spaces and query/hash suffixes", () => {
    expect(
      documentationLinks(
        "[Theme](<My Theme.md#color>)\n![Demo](image.png?v=2)",
      ),
    ).toEqual([
      { target: "My Theme.md#color", line: 1 },
      { target: "image.png?v=2", line: 2 },
    ]);
  });
  it("finds dark/light picture assets and multiline tags", () => {
    expect(
      documentationLinks(
        '<picture>\n<source\n media="dark" srcset="dark.png">\n<img src="light.png">\n</picture>',
      ),
    ).toEqual([
      { target: "dark.png", line: 3 },
      { target: "light.png", line: 4 },
    ]);
  });
  it("checks all local width/density srcset candidates", () => {
    expect(
      documentationLinks(
        "<source srcset=\"small.png 800w, large.png 1600w\"><img srcset='one.png, two.png 2x'>",
      ).map((l) => l.target),
    ).toEqual(["small.png", "large.png", "one.png", "two.png"]);
  });
  it("does not interpret a data URL comma as a local filename", () => {
    expect(
      documentationLinks(
        '<img srcset="data:image/png;base64,AAAA 1x, local.png 2x">',
      ),
    ).toEqual([{ target: "local.png", line: 1 }]);
  });
  it("ignores remote URLs, email, protocol-relative and fragment links", () => {
    expect(
      documentationLinks(
        "[Web](https://example.test/a) [Mail](mailto:a@example.test) [CDN](//example.test/x) [Here](#here)",
      ),
    ).toEqual([]);
  });
  it("does not scan fenced or inline code examples", () => {
    expect(
      documentationLinks(
        '```html\n<img src="ignored.png">\n```\n`[code](ignored.md)`\n[Read](read.md)',
      ),
    ).toEqual([{ target: "read.md", line: 5 }]);
  });
  it("requires the matching fence marker and sufficient closing length", () => {
    expect(
      documentationLinks(
        "````md\n```\n[Hidden](hidden.md)\n~~~\n````\n[Read](read.md)",
      ),
    ).toEqual([{ target: "read.md", line: 6 }]);
  });
  it("ignores HTML comments without changing line numbers", () => {
    expect(
      documentationLinks('<!--\n<img src="old.png">\n-->\n<img src="new.png">'),
    ).toEqual([{ target: "new.png", line: 4 }]);
  });
  it("checks reference definitions and decodes HTML attribute entities", () => {
    expect(
      documentationLinks(
        '[guide]: <guide with spaces.md>\n<a href="guide.md?a=1&amp;b=2">Read</a>',
      ),
    ).toEqual([
      { target: "guide with spaces.md", line: 1 },
      { target: "guide.md?a=1&b=2", line: 2 },
    ]);
  });
  it("does not mistake footnote prose for a reference URL", () => {
    expect(
      documentationLinks("[^proof]: An explanation, not a filename."),
    ).toEqual([]);
  });
  it("reports the attribute line when it starts on a new line", () => {
    expect(documentationLinks('<img\n  src="banner.png"\n>')).toEqual([
      { target: "banner.png", line: 2 },
    ]);
  });
});
