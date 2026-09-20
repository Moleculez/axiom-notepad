import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { readOffice } from "../apps/web/lib/tools/office-parse";
import { readWorkbook } from "../apps/web/lib/tools/workbook-parse";
import { officePlainText } from "@axiom/shared/office-preview";
import {
  cellAddress,
  parseCellAddress,
  workbookNumber,
  workbookRange,
  workbookViewRows,
  workbookCellAnchor,
  type WorkbookSheet,
} from "@axiom/shared/workbook-preview";
import { wordFixture, slidesFixture } from "./helpers/office-fixtures";
describe("safe Office reading", () => {
  it("keeps Word headings, tables, comments and footnotes as inert text", async () => {
    const zip = await wordFixture(),
      data = await readOffice(
        await zip.generateAsync({ type: "arraybuffer" }),
        "docx",
      );
    expect(data.blocks[0]).toMatchObject({
      kind: "paragraph",
      text: "Energy & evidence",
      heading: 1,
    });
    expect(data.blocks[1]).toMatchObject({
      text: "Observed alpha\tβ uncertainty.",
    });
    expect(data.blocks[2]).toMatchObject({
      kind: "table",
      rows: [
        ["Mass", "Energy"],
        ["2", "6"],
      ],
    });
    expect(data.blocks[3]).toMatchObject({ heading: 2 });
    expect(data.comments[0]).toMatchObject({
      author: "External researcher",
      text: "Check calibration",
    });
    expect(data.footnotes).toEqual([
      { id: "Footnote 1", text: "Source measurement" },
    ]);
    expect(officePlainText(data)).toContain("<script>");
    expect(officePlainText(data)).not.toContain("Deleted claim");
  });
  it("uses presentation relationships for slide order and extracts speaker notes", async () => {
    const zip = await slidesFixture(),
      data = await readOffice(
        await zip.generateAsync({ type: "arraybuffer" }),
        "pptx",
      );
    expect(data.slides.map((s) => s.title)).toEqual([
      "Research results",
      "Appendix",
    ]);
    expect(data.slides[0].notes).toBe("Explain the calibration uncertainty.");
    expect(data.slides[1].hidden).toBe(true);
    expect(officePlainText(data)).toContain("Speaker notes");
  });
  it("rejects DTDs, malformed XML, macros, path traversal and missing slide relationships", async () => {
    for (const malicious of [
      "<!DOCTYPE w:document [<!ENTITY leak SYSTEM 'file:///etc/passwd'>]><w:document/>",
      "<w:document><w:body></w:document>",
    ]) {
      const zip = await wordFixture();
      zip.file("word/document.xml", malicious);
      await expect(
        readOffice(await zip.generateAsync({ type: "arraybuffer" }), "docx"),
      ).rejects.toThrow();
    }
    for (const path of [
      "word/vbaProject.bin",
      "../escape.xml",
      "word/embeddings/object.bin",
    ]) {
      const zip = await wordFixture();
      zip.file(path, "bad");
      await expect(
        readOffice(await zip.generateAsync({ type: "arraybuffer" }), "docx"),
      ).rejects.toThrow();
    }
    const zip = await slidesFixture();
    zip.remove("ppt/_rels/presentation.xml.rels");
    await expect(
      readOffice(await zip.generateAsync({ type: "arraybuffer" }), "pptx"),
    ).rejects.toThrow("relationship");
  });
});
describe("workbook reading", () => {
  it("preserves cached values, basic styles, merged cells and frozen panes", async () => {
    const book = new ExcelJS.Workbook(),
      sheet = book.addWorksheet("Results");
    sheet.addRows([
      ["Merged title", ""],
      ["Mass", "Energy"],
      [2, { formula: "A3*3", result: 6 }],
      [0.1234, { formula: "A3*4" }],
    ]);
    sheet.mergeCells("A1:B1");
    sheet.getCell("A1").font = { bold: true, color: { argb: "FF123456" } };
    sheet.getCell("A4").numFmt = "0.00%";
    sheet.getColumn(1).width = 24;
    sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 2 }];
    sheet.getRow(4).hidden = true;
    book.addWorksheet("No view settings").addRow(["Standalone"]);
    const data = await readWorkbook(
        (await book.xlsx.writeBuffer()) as ArrayBuffer,
      ),
      s = data.sheets[0];
    expect(s.rows[0][1].text).toBe("");
    expect(s.rows[2][1]).toMatchObject({
      formula: "A3*3",
      number: 6,
      text: "6",
    });
    expect(s.rows[3][0].text).toBe("12.34%");
    expect(data.styles[s.rows[0][0].style!]).toMatchObject({
      bold: true,
      color: "#123456",
    });
    expect(s.merges).toEqual([{ top: 0, bottom: 0, left: 0, right: 1 }]);
    expect(s).toMatchObject({ frozenRows: 2, frozenColumns: 1 });
    expect(workbookCellAnchor(s, { row: 0, column: 1 })).toEqual({
      row: 0,
      column: 0,
    });
    expect(data.warnings.join(" ")).toContain("no saved result");
    expect(data.warnings.join(" ")).toContain("Hidden rows");
  });
  it("sorts and filters a view without losing original addresses or changing original data", () => {
    const sheet: WorkbookSheet = {
      name: "Sample",
      rows: [
        [{ text: "Mass" }],
        [{ text: "20", number: 20 }],
        [{ text: "2", number: 2 }],
      ],
      widths: [100],
      heights: [30, 30, 30],
      merges: [],
      frozenRows: 1,
      frozenColumns: 0,
      hidden: false,
      truncated: false,
    };
    const before = JSON.stringify(sheet),
      rows = workbookViewRows(sheet, "", { column: 0, direction: "asc" });
    expect(rows).toEqual([0, 2, 1]);
    expect(workbookViewRows(sheet, "2")).toEqual([1, 2]);
    expect(
      workbookRange(sheet, rows, { row: 2, column: 0 }, { row: 1, column: 0 }),
    ).toMatchObject({ text: "2\n20", sum: 22, average: 11, count: 2 });
    expect(JSON.stringify(sheet)).toBe(before);
    expect(cellAddress(99, 27)).toBe("AB100");
    expect(parseCellAddress("ab100")).toEqual({ row: 99, column: 27 });
    expect(parseCellAddress("A0")).toBeNull();
  });
  it("guards clipboard formula injection and refuses oversized selections", () => {
    const sheet = {
      rows: [[{ text: '=WEBSERVICE("example")' }, { text: "-2", number: -2 }]],
    } as WorkbookSheet;
    expect(
      workbookRange(sheet, [0], { row: 0, column: 0 }, { row: 0, column: 1 })
        .text,
    ).toBe('\'=WEBSERVICE("example")\t-2');
    expect(() =>
      workbookRange(
        sheet,
        [0],
        { row: 0, column: 0 },
        { row: 0, column: 10000 },
      ),
    ).toThrow("10,000");
    expect(workbookNumber(1234.5, "$#,##0.00")).toBe("$1,234.50");
    expect(workbookNumber(0.2, "0%")).toBe("20%");
  });
});
