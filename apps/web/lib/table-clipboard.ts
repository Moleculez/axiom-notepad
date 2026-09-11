import { safeUrl } from "@axiom/markdown";
export function htmlTableClipboard(html: string): string[][] | null {
  if (!html) return null;
  if (html.length > 1_000_000)
    throw new Error("Table paste is limited to 1 MB.");
  // Template contents are inert: images/scripts cannot run or request resources.
  const template = document.createElement("template");
  template.innerHTML = html;
  const table = template.content.querySelector("table");
  if (!table) return null;
  const inline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof Element)) return "";
    if (
      [
        "SCRIPT",
        "STYLE",
        "IFRAME",
        "OBJECT",
        "EMBED",
        "SVG",
        "IMG",
        "TABLE",
      ].includes(node.tagName)
    )
      return "";
    if (node.tagName === "BR") return "\n";
    const text = Array.from(node.childNodes).map(inline).join("");
    if (["B", "STRONG"].includes(node.tagName)) return `**${text}**`;
    if (["I", "EM"].includes(node.tagName)) return `*${text}*`;
    if (node.tagName === "CODE") return "`" + text.replace(/`/g, "\\`") + "`";
    if (node.tagName === "A") {
      const href = safeUrl(node.getAttribute("href") ?? "");
      return href
        ? `[${text.replace(/\]/g, "\\]")}](${href.replace(/\)/g, "%29")})`
        : text;
    }
    return text + (["P", "DIV"].includes(node.tagName) ? "\n" : "");
  };
  const rows = Array.from(table.querySelectorAll("tr")).filter(
    (row) => row.closest("table") === table,
  );
  if (rows.length > 1000) throw new Error("Tables support up to 1,000 rows.");
  const result = rows.map((row) =>
    Array.from(row.children)
      .filter((cell) => ["TH", "TD"].includes(cell.tagName))
      .map((cell) => {
        if (
          Number(cell.getAttribute("rowspan") ?? 1) > 1 ||
          Number(cell.getAttribute("colspan") ?? 1) > 1
        )
          throw new Error("Unmerge cells in the source table before pasting.");
        return Array.from(cell.childNodes)
          .map(inline)
          .join("")
          .replace(/\n$/, "");
      }),
  );
  const width = Math.max(0, ...result.map((row) => row.length));
  if (width > 100) throw new Error("Tables support up to 100 columns.");
  return width
    ? result.map((row) => [...row, ...Array(width - row.length).fill("")])
    : null;
}
