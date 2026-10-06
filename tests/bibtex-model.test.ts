import { expect, it } from "vitest";
import {
  scanBibtex,
  bibtexRecordSource,
  renameBibtexRecord,
} from "../packages/shared/src/bibtex-model";
import {
  parseBibtex,
  updateBibtexEntry,
} from "../packages/shared/src/bibliography";
it("resolves quoted/braced/concatenated values, parentheses and forward strings losslessly", () => {
  const source =
    '% @fake{not-an-entry}\n@article(key,title="A {nested} \\"quote\\"",journal=prefix # { journal},year=2026,unknown={keep})\n@string{prefix={Research}}';
  const parsed = parseBibtex(source)[0];
  expect(parsed.venue).toBe("Research journal");
  expect(parsed.title).toBe('A nested \\"quote\\"');
  const edited = updateBibtexEntry(parsed.bibtex, "key", {
    year: "2027",
    pages: "1--9",
  });
  expect(edited).toContain("journal=prefix # { journal}");
  expect(edited).toContain("unknown={keep}");
  expect(edited).toContain("year={2027}");
  expect(edited).toContain("pages = {1--9}");
  expect(renameBibtexRecord(edited, "alias")).toContain("@article(alias,");
});
it("keeps only the selected record's transitive string context", () => {
  const doc = scanBibtex(
    "@string{private={unrelated secret}}\n@string{prefix={Lab}}\n@string{venue=prefix # { Notes}}\n@article{key,title={Visible},journal=venue}",
  );
  const source = bibtexRecordSource(doc, doc.records.at(-1)!);
  expect(source).toContain("prefix={Lab}");
  expect(source).toContain("venue=prefix");
  expect(source).not.toContain("unrelated secret");
});
it("reports cycles and unresolved strings rather than evaluating TeX", () => {
  const p = scanBibtex(
    "@string{a=b}\n@string{b=a}\n@article{key,title=a,journal=missing}",
  );
  expect(p.warnings.some((w) => w.includes("Cyclic"))).toBe(true);
  expect(p.warnings.some((w) => w.includes("Unresolved"))).toBe(true);
});
it("bounds exponential string expansion", () => {
  const defs = Array.from(
    { length: 30 },
    (_, i) => `@string{x${i}=${i ? `x${i - 1} # x${i - 1}` : "{x}"}}`,
  ).join("\n");
  const p = scanBibtex(defs + "\n@article{key,title=x29}");
  expect(p.records.at(-1)!.fields.title.value.length).toBeLessThanOrEqual(
    200_000,
  );
  expect(p.warnings.some((w) => w.includes("limit"))).toBe(true);
});
it("retains preambles as inert source and rejects unclosed data", () => {
  expect(scanBibtex('@preamble{"not executed"}').warnings).toHaveLength(1);
  expect(() => scanBibtex("@article{key,title={Unclosed}")).toThrow("Unclosed");
});
