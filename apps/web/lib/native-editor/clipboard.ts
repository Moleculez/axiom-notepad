import { safeUrl } from "@axiom/markdown";

/** Convert supported clipboard HTML to Markdown; never insert clipboard DOM. */
export function htmlMarkdown(html: string) {
  const doc = new DOMParser().parseFromString(
    html.slice(0, 4_000_000),
    "text/html",
  );
  doc
    .querySelectorAll(
      "script,style,iframe,object,embed,link,meta,template,noscript",
    )
    .forEach((el) => el.remove());
  const text = (node: Node, depth = 0): string => {
    if (depth > 40) return node.textContent ?? "";
    if (node.nodeType === Node.TEXT_NODE)
      return (node.textContent ?? "").replace(/[\\`*_\[\]~]/g, "\\$&");
    if (!(node instanceof Element)) return "";
    const children = () =>
      Array.from(node.childNodes, (child) => text(child, depth + 1)).join("");
    const body = children();
    switch (node.tagName.toLowerCase()) {
      case "strong":
      case "b":
        return "**" + body + "**";
      case "em":
      case "i":
        return "*" + body + "*";
      case "s":
      case "del":
        return "~~" + body + "~~";
      case "mark":
        return "==" + body + "==";
      case "sub":
        return "~" + body + "~";
      case "sup":
        return "^" + body + "^";
      case "u":
        return "<u>" + body + "</u>";
      case "code": {
        const value = node.textContent ?? "",
          fence = "`".repeat(
            Math.max(
              1,
              ...Array.from(value.matchAll(/`+/g), (m) => m[0].length + 1),
            ),
          );
        return fence + value + fence;
      }
      case "pre": {
        const value = node.textContent ?? "",
          fence = "`".repeat(
            Math.max(
              3,
              ...Array.from(value.matchAll(/`+/g), (m) => m[0].length + 1),
            ),
          );
        return (
          "\n\n" +
          fence +
          "\n" +
          value.replace(/\n$/, "") +
          "\n" +
          fence +
          "\n\n"
        );
      }
      case "a": {
        const href = safeUrl(node.getAttribute("href") ?? "");
        return href
          ? `[${body}](${href.replace(/\(/g, "%28").replace(/\)/g, "%29")})`
          : body;
      }
      case "img": {
        const src = safeUrl(node.getAttribute("src") ?? "", true);
        return /^\/api\/v1\/(?:attachments|files)\//.test(src)
          ? `![${(node.getAttribute("alt") ?? "Image").replace(/[\[\]]/g, "")}](${src.replace(/\(/g, "%28").replace(/\)/g, "%29")})`
          : "";
      }
      case "br":
        return "  \n";
      case "hr":
        return "\n\n---\n\n";
      case "blockquote":
        return "\n\n" + body.trim().replace(/^/gm, "> ") + "\n\n";
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        return (
          "\n\n" +
          "#".repeat(Number(node.tagName[1])) +
          " " +
          body.trim() +
          "\n\n"
        );
      case "ul":
      case "ol": {
        let index = Number(node.getAttribute("start") ?? 1);
        return (
          "\n" +
          Array.from(node.children)
            .filter((child) => child.tagName === "LI")
            .map((child) => {
              const marker = node.tagName === "OL" ? `${index++}. ` : "- ";
              return (
                marker +
                Array.from(child.childNodes, (n) => text(n, depth + 1))
                  .join("")
                  .trim()
                  .replace(/\n/g, "\n" + " ".repeat(marker.length))
              );
            })
            .join("\n") +
          "\n"
        );
      }
      case "p":
      case "div":
        return "\n\n" + body.trim() + "\n\n";
      default:
        return body;
    }
  };
  return Array.from(doc.body.childNodes, (node) => text(node))
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
export function htmlTableGrid(html: string) {
  const table = new DOMParser()
    .parseFromString(html.slice(0, 4_000_000), "text/html")
    .querySelector("table");
  if (!table) return null;
  if (table.rows.length > 1000)
    throw new Error("Paste up to 1,000 rows at a time.");
  const grid: string[][] = [];
  Array.from(table.rows).forEach((row, r) => {
    grid[r] ??= [];
    let c = 0;
    for (const cell of row.cells) {
      while (grid[r][c] !== undefined) c++;
      const rowSpan = Math.max(1, cell.rowSpan),
        colSpan = Math.max(1, cell.colSpan);
      if (r + rowSpan > 1000 || c + colSpan > 100)
        throw new Error("Paste up to 100 columns and 1,000 rows at a time.");
      grid[r][c] = htmlMarkdown(cell.innerHTML).replace(/ {2}\n/g, "\n");
      for (let dy = 0; dy < rowSpan; dy++) {
        grid[r + dy] ??= [];
        for (let dx = 0; dx < colSpan; dx++)
          if (dy || dx) grid[r + dy][c + dx] = "";
      }
      c += colSpan;
    }
  });
  const width = Math.max(...grid.map((row) => row.length));
  return grid.map((row) =>
    Array.from({ length: width }, (_, c) => row[c] ?? ""),
  );
}
