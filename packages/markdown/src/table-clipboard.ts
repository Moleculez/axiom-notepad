/** Quoted TSV preserves tabs, newlines and quotes inside spreadsheet cells. */
export function parseTSV(
  text: string,
  maxRows = 1000,
  maxColumns = 100,
): string[][] {
  if (text.length > 1_000_000)
    throw new Error("Table paste is limited to 1 MB.");
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    start = true;
  const cell = () => {
    row.push(field);
    field = "";
    start = true;
    if (row.length > maxColumns)
      throw new Error("Tables support up to 100 columns.");
  };
  const line = () => {
    cell();
    rows.push(row);
    row = [];
    if (rows.length > maxRows)
      throw new Error("Tables support up to 1,000 rows.");
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && start) {
      quoted = true;
      start = false;
    } else if (char === "\t") cell();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      line();
    } else {
      field += char;
      start = false;
    }
  }
  if (quoted)
    throw new Error("The pasted table contains an unclosed quoted cell.");
  if (field || row.length || !rows.length || !/[\r\n]$/.test(text)) line();
  const width = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array(width - r.length).fill("")]);
}
export function writeTSV(rows: string[][]) {
  return rows
    .map((row) =>
      row
        .map((text) =>
          /[\t\n\r"]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text,
        )
        .join("\t"),
    )
    .join("\n");
}
