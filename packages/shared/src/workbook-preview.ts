export type WorkbookCell = {
  text: string;
  number?: number;
  formula?: string;
  style?: number;
};
export type WorkbookStyle = {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  background?: string;
  align?: "left" | "center" | "right";
  fontSize?: number;
  wrap?: boolean;
  underline?: boolean;
  border?: boolean;
};
export type WorkbookMerge = {
  top: number;
  left: number;
  bottom: number;
  right: number;
};
export type WorkbookSheet = {
  name: string;
  rows: WorkbookCell[][];
  widths: number[];
  heights: number[];
  merges: WorkbookMerge[];
  frozenRows: number;
  frozenColumns: number;
  hidden: boolean;
  truncated: boolean;
};
export type WorkbookSnapshot = {
  sheets: WorkbookSheet[];
  styles: WorkbookStyle[];
  warnings: string[];
};
export function columnName(index: number) {
  let label = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
  return label;
}
export function cellAddress(row: number, column: number) {
  return `${columnName(column)}${row + 1}`;
}
export function parseCellAddress(text: string) {
  const match = /^([A-Z]{1,3})([1-9]\d{0,5})$/i.exec(text.trim());
  if (!match) return null;
  const column =
    [...match[1].toUpperCase()].reduce(
      (n, char) => n * 26 + char.charCodeAt(0) - 64,
      0,
    ) - 1;
  return { row: Number(match[2]) - 1, column };
}
export function workbookCellAnchor(
  sheet: WorkbookSheet,
  cell: { row: number; column: number },
) {
  const merge = sheet.merges.find(
    (range) =>
      cell.row >= range.top &&
      cell.row <= range.bottom &&
      cell.column >= range.left &&
      cell.column <= range.right,
  );
  return merge ? { row: merge.top, column: merge.left } : cell;
}
export function workbookNumber(value: number, format = "") {
  if (!Number.isFinite(value)) return String(value);
  const positive = format.split(";")[0].replace(/\[[^\]]*\]/g, "");
  if (!positive || /^general$/i.test(positive)) return String(value);
  if (/e[+-]0/i.test(positive))
    return value.toExponential(
      Math.min(10, /\.([0#]+)/.exec(positive)?.[1].length ?? 2),
    );
  const percent = positive.includes("%"),
    decimals = Math.min(10, /\.([0#]+)/.exec(positive)?.[1].length ?? 0);
  if (
    !/[0#]/.test(positive) ||
    /[dmyhs]/i.test(positive.replace(/"[^"]*"/g, ""))
  )
    return String(value);
  const currency = /[$€£¥]/.exec(positive)?.[0] ?? "";
  return (
    currency +
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: /[0#],[0#]/.test(positive),
    }).format(percent ? value * 100 : value) +
    (percent ? "%" : "")
  );
}
export function workbookViewRows(
  sheet: WorkbookSheet,
  query: string,
  sort?: { column: number; direction: "asc" | "desc" },
) {
  const term = query.toLocaleLowerCase().trim();
  const rows = sheet.rows
    .map((_, i) => i)
    .filter(
      (i) =>
        !term ||
        sheet.rows[i].some((cell) =>
          cell.text.toLocaleLowerCase().includes(term),
        ),
    );
  if (sort && !sheet.merges.length)
    rows.sort((a, b) => {
      if (a < sheet.frozenRows || b < sheet.frozenRows) return a - b;
      const ca = sheet.rows[a][sort.column],
        cb = sheet.rows[b][sort.column];
      const result =
        ca?.number !== undefined && cb?.number !== undefined
          ? ca.number - cb.number
          : (ca?.text ?? "").localeCompare(cb?.text ?? "", undefined, {
              numeric: true,
            });
      return result * (sort.direction === "asc" ? 1 : -1) || a - b;
    });
  return rows;
}
export function workbookRange(
  sheet: WorkbookSheet,
  viewRows: number[],
  start: { row: number; column: number },
  end = start,
) {
  const a = viewRows.indexOf(start.row),
    b = viewRows.indexOf(end.row);
  if (a < 0 || b < 0)
    return { text: "", count: 0, numbers: 0, sum: 0, average: 0 };
  const left = Math.min(start.column, end.column),
    right = Math.max(start.column, end.column);
  if ((Math.abs(a - b) + 1) * (right - left + 1) > 10000)
    throw new Error("Select at most 10,000 cells for copying and statistics.");
  let count = 0,
    numbers = 0,
    sum = 0;
  const text = viewRows
    .slice(Math.min(a, b), Math.max(a, b) + 1)
    .map((row) =>
      Array.from({ length: right - left + 1 }, (_, i) => {
        const cell = sheet.rows[row][left + i];
        if (cell?.text) count++;
        if (cell?.number !== undefined) {
          numbers++;
          sum += cell.number;
        }
        let value = (cell?.text ?? "").replace(/[\t\r\n]+/g, " ");
        if (cell?.number === undefined && /^[\s]*[=+@-]/.test(value))
          value = "'" + value;
        return value;
      }).join("\t"),
    )
    .join("\n");
  if (text.length > 2_000_000)
    throw new Error("This selection exceeds the 2 MB clipboard limit.");
  return { text, count, numbers, sum, average: numbers ? sum / numbers : 0 };
}
