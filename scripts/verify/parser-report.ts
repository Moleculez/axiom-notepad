import { readFileSync } from "node:fs";
import {
  parseMarkdown,
  renderDocument,
} from "../../packages/markdown/src/index";
let total = 0,
  failed = 0;
for (const dialect of ["commonmark", "gfm"] as const)
  for (const f of JSON.parse(
    readFileSync(`tests/fixtures/${dialect}.json`, "utf8"),
  )) {
    total++;
    const actual = renderDocument(parseMarkdown(f.markdown, dialect), {
      conformance: true,
    });
    if (actual !== f.html) {
      failed++;
      console.log(
        `${dialect} ${f.example} ${f.section}\nSOURCE ${JSON.stringify(f.markdown)}\nWANT ${JSON.stringify(f.html)}\nGOT ${JSON.stringify(actual)}`,
      );
    }
  }
console.log(`${total - failed}/${total} passing; ${failed} failing`);
