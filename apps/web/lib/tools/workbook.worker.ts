import ExcelJS from "exceljs";
import JSZip from "jszip";
self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    if (event.data.byteLength > 25_000_000)
      throw new Error("Workbook is too large.");
    const archive = await JSZip.loadAsync(event.data);
    let expanded = 0,
      count = 0;
    for (const entry of Object.values(archive.files)) {
      const item = entry as typeof entry & {
        _data?: { uncompressedSize?: number };
      };
      expanded += item._data?.uncompressedSize ?? 0;
      if (
        ++count > 20000 ||
        expanded > 100_000_000 ||
        /(^|\/)\.\.(\/|$)/.test(entry.name)
      )
        throw new Error("Workbook exceeds the safe expansion limit.");
    }
    if (
      !archive.file("[Content_Types].xml") ||
      !archive.file("xl/workbook.xml")
    )
      throw new Error("This is not a supported XLSX workbook.");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(event.data);
    let remainingCells = 2_000_000;
    const sheets = workbook.worksheets.slice(0, 100).map((sheet) => {
      const rows: string[][] = [];
      const count = Math.min(50000, sheet.rowCount),
        columns = Math.min(256, sheet.columnCount);
      remainingCells -= count * columns;
      if (remainingCells < 0)
        throw new Error("This workbook has too many cells for a safe preview.");
      for (let r = 1; r <= count; r++) {
        const row: string[] = [];
        for (let c = 1; c <= columns; c++) {
          const value = sheet.getCell(r, c).value;
          const cached =
            value &&
            typeof value === "object" &&
            ("formula" in value || "sharedFormula" in value)
              ? value.result
              : value;
          row.push(
            cached instanceof Date
              ? cached.toISOString().slice(0, 10)
              : cached && typeof cached === "object"
                ? "richText" in cached
                  ? cached.richText.map((t) => t.text).join("")
                  : "text" in cached
                    ? cached.text
                    : "error" in cached
                      ? cached.error
                      : ""
                : String(cached ?? ""),
          );
        }
        rows.push(row);
      }
      return {
        name: sheet.name,
        rows,
        truncated: sheet.rowCount > count || sheet.columnCount > columns,
      };
    });
    self.postMessage({ sheets });
  } catch (e) {
    self.postMessage({
      error: e instanceof Error ? e.message : "Unable to preview workbook.",
    });
  }
};
