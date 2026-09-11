import { mkdir, writeFile } from "node:fs/promises";
await mkdir("tests/fixtures", { recursive: true });
const common = await fetch("https://spec.commonmark.org/0.31.2/spec.json");
if (!common.ok) throw new Error("CommonMark fixture download failed");
await writeFile("tests/fixtures/commonmark.json", await common.text());
const gfm = await fetch(
  "https://raw.githubusercontent.com/github/cmark-gfm/master/test/spec.txt",
);
if (!gfm.ok) throw new Error("GFM fixture download failed");
const text = await gfm.text();
const examples: {
  markdown: string;
  html: string;
  section: string;
  example: number;
}[] = [];
let section = "",
  example = 0;
const lines = text.split("\n");
for (let i = 0; i < lines.length; i++) {
  if (/^#{1,6} /.test(lines[i])) section = lines[i].replace(/^#+ /, "");
  if (/^`{32} example/.test(lines[i])) {
    const md: string[] = [],
      html: string[] = [];
    let output = false;
    i++;
    for (; i < lines.length && !/^`{32}$/.test(lines[i]); i++) {
      if (lines[i] === ".") output = true;
      else (output ? html : md).push(lines[i].replace(/→/g, "\t"));
    }
    example++;
    if (section.includes("(extension)"))
      examples.push({
        markdown: md.join("\n") + "\n",
        html: html.join("\n") + "\n",
        section,
        example,
      });
  }
}
await writeFile("tests/fixtures/gfm.json", JSON.stringify(examples, null, 2));
console.log(
  "Downloaded CommonMark 0.31.2 and",
  examples.length,
  "GFM extension fixtures.",
);
