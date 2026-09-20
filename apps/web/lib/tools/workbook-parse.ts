import ExcelJS from "exceljs";
import JSZip from "jszip";
import {
  workbookNumber,
  parseCellAddress,
  type WorkbookSnapshot,
  type WorkbookCell,
  type WorkbookStyle,
} from "@axiom/shared/workbook-preview";
const finite = (value: number | undefined, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export async function readWorkbook(
  data: ArrayBuffer,
): Promise<WorkbookSnapshot> {
  if (data.byteLength > 25_000_000)
    throw new Error("Workbook exceeds the 25 MB preview limit.");
  const archive = await JSZip.loadAsync(data);
  let expanded = 0,
    count = 0;
  for (const entry of Object.values(archive.files)) {
    const originalName =
      (entry as typeof entry & { unsafeOriginalName?: string })
        .unsafeOriginalName ?? entry.name;
    expanded +=
      (entry as typeof entry & { _data?: { uncompressedSize?: number } })._data
        ?.uncompressedSize ?? 0;
    if (
      ++count > 20000 ||
      expanded > 100_000_000 ||
      /(^|[\/\\])\.\.([\/\\]|$)|^[/\\]/.test(originalName)
    )
      throw new Error(
        "Workbook exceeds safe expansion limits or contains unsafe paths.",
      );
    if (/vbaProject|embeddings\//i.test(entry.name))
      throw new Error(
        "Macro-bearing workbooks and embedded objects are not previewed.",
      );
  }
  if (!archive.file("[Content_Types].xml") || !archive.file("xl/workbook.xml"))
    throw new Error("This is not a supported XLSX workbook.");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(data);
  let budget = 2_000_000,
    characters = 0;
  const styles: WorkbookStyle[] = [{}],
    styleKeys = new Map<string, number>([["{}", 0]]),
    warnings = new Set<string>();
  const color = (value?: Partial<ExcelJS.Color>) =>
    value?.argb && /^(?:[\da-f]{2})?([\da-f]{6})$/i.test(value.argb)
      ? "#" + value.argb.slice(-6)
      : undefined;
  if (book.worksheets.length > 100)
    warnings.add("Only the first 100 worksheets are shown.");
  const sheets = book.worksheets.slice(0, 100).map((sheet) => {
    const rows: WorkbookCell[][] = [],
      rowCount = Math.min(50000, sheet.rowCount),
      columns = Math.min(256, sheet.columnCount);
    budget -= rowCount * columns;
    if (budget < 0)
      throw new Error("Workbook exceeds the 2 million cell preview limit.");
    for (let r = 1; r <= rowCount; r++) {
      if (sheet.getRow(r).hidden)
        warnings.add(
          "Hidden rows and columns are included in reading view. This does not change the original workbook.",
        );
      const row: WorkbookCell[] = [];
      for (let c = 1; c <= columns; c++) {
        const cell = sheet.getCell(r, c),
          value =
            cell.isMerged && cell.master.address !== cell.address
              ? undefined
              : cell.value;
        if (r === 1 && sheet.getColumn(c).hidden)
          warnings.add(
            "Hidden rows and columns are included in reading view. This does not change the original workbook.",
          );
        const isFormula =
          value &&
          typeof value === "object" &&
          ("formula" in value || "sharedFormula" in value);
        const cached = isFormula ? value.result : value;
        const formula = isFormula ? cell.formula : undefined;
        if (formula && formula.length > 8192)
          throw new Error("A formula exceeds the preview limit.");
        if (isFormula && cached === undefined)
          warnings.add(
            "Some formulas have no saved result. Formulas are displayed, never calculated.",
          );
        const text =
          cached instanceof Date
            ? cached.toISOString().slice(0, 10)
            : typeof cached === "number"
              ? workbookNumber(cached, cell.numFmt)
              : cached && typeof cached === "object"
                ? "richText" in cached
                  ? cached.richText.map((t) => t.text).join("")
                  : "text" in cached
                    ? cached.text
                    : "error" in cached
                      ? cached.error
                      : ""
                : String(cached ?? "");
        characters += text.length + (formula?.length ?? 0);
        if (text.length > 32767 || characters > 20_000_000)
          throw new Error("Workbook text exceeds its safe preview budget.");
        const style: WorkbookStyle = {};
        if (cell.font?.bold) style.bold = true;
        if (cell.font?.italic) style.italic = true;
        if (cell.font?.underline) style.underline = true;
        if (color(cell.font?.color)) style.color = color(cell.font.color);
        if (cell.font?.size)
          style.fontSize = Math.max(
            10,
            Math.min(32, (finite(cell.font.size, 11) * 4) / 3),
          );
        if (cell.fill?.type === "pattern" && cell.fill.pattern === "solid")
          style.background = color(cell.fill.fgColor);
        if (
          ["left", "center", "right"].includes(cell.alignment?.horizontal ?? "")
        )
          style.align = cell.alignment.horizontal as WorkbookStyle["align"];
        if (cell.alignment?.wrapText) style.wrap = true;
        if (cell.border && Object.values(cell.border).some((b) => b?.style))
          style.border = true;
        const key = JSON.stringify(style);
        let styleId = styleKeys.get(key);
        if (styleId === undefined) {
          if (styles.length >= 2048)
            throw new Error("Workbook exceeds 2,048 distinct display styles.");
          styleId = styles.push(style) - 1;
          styleKeys.set(key, styleId);
        }
        row.push({
          text,
          ...(typeof cached === "number" && Number.isFinite(cached)
            ? { number: cached }
            : {}),
          ...(formula ? { formula } : {}),
          ...(styleId ? { style: styleId } : {}),
        });
      }
      rows.push(row);
    }
    const merges = (sheet.model.merges ?? []).flatMap((range) => {
      const [from, to] = range.split(":"),
        a = parseCellAddress(from),
        b = parseCellAddress(to ?? from);
      if (!a || !b || a.row >= rowCount || a.column >= columns) return [];
      if (b.row >= rowCount || b.column >= columns)
        warnings.add("Some merged cells extend beyond the preview boundary.");
      return [
        {
          top: a.row,
          left: a.column,
          bottom: Math.min(rowCount - 1, b.row),
          right: Math.min(columns - 1, b.column),
        },
      ];
    });
    if (merges.length > 10000)
      throw new Error("Workbook has too many merged ranges.");
    const frozen = (sheet.views ?? []).find(
      (view) => view.state === "frozen",
    ) as Partial<ExcelJS.WorksheetViewFrozen> | undefined;
    if (frozen && ((frozen.ySplit ?? 0) > 10 || (frozen.xSplit ?? 0) > 4))
      warnings.add(
        "Large frozen panes are bounded to 10 rows and 4 columns in the viewer.",
      );
    return {
      name: sheet.name,
      rows,
      widths: Array.from({ length: columns }, (_, i) =>
        Math.max(
          48,
          Math.min(500, finite(sheet.getColumn(i + 1).width, 18) * 7 + 10),
        ),
      ),
      heights: Array.from({ length: rowCount }, (_, i) =>
        Math.max(
          28,
          Math.min(120, (finite(sheet.getRow(i + 1).height, 22) * 4) / 3),
        ),
      ),
      merges,
      frozenRows: Math.floor(
        Math.max(0, Math.min(10, rowCount, finite(frozen?.ySplit, 0))),
      ),
      frozenColumns: Math.floor(
        Math.max(0, Math.min(4, columns, finite(frozen?.xSplit, 0))),
      ),
      hidden: sheet.state !== "visible",
      truncated: sheet.rowCount > rowCount || sheet.columnCount > columns,
    };
  });
  return { sheets, styles, warnings: [...warnings] };
}
