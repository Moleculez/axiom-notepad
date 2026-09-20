import type { PdfView } from "./pdf-reader";
export type PdfPageSize = { width: number; height: number };
export function pdfPageLayout(
  count: number,
  sizes: Map<number, PdfPageSize>,
  width: number,
  height: number,
  scale: number | "fit" | "page",
  view: PdfView,
) {
  const columns = view === "facing" ? 2 : 1,
    available = (width - (columns - 1) * 16) / columns;
  const result: {
    page: number;
    top: number;
    left: number;
    width: number;
    height: number;
  }[] = [];
  let top = 20;
  for (let index = 0; index < count; index += columns) {
    const row = Array.from(
      { length: Math.min(columns, count - index) },
      (_, j) => {
        const page = index + j + 1,
          d = sizes.get(page) ?? { width: 612, height: 792 };
        const factor =
          scale === "fit"
            ? available / d.width
            : scale === "page"
              ? Math.min(available / d.width, height / d.height)
              : scale;
        return {
          page,
          top,
          left: 0,
          width: d.width * factor,
          height: d.height * factor,
        };
      },
    );
    let left =
      20 +
      Math.max(
        0,
        (width - row.reduce((n, p) => n + p.width, 0) - (row.length - 1) * 16) /
          2,
      );
    for (const page of row) {
      page.left = left;
      left += page.width + 16;
      result.push(page);
    }
    top += Math.max(...row.map((p) => p.height)) + 16;
  }
  return {
    pages: result,
    height: top + 4,
    width: result.reduce(
      (extent, p) => Math.max(extent, p.left + p.width + 20),
      width + 40,
    ),
  };
}
export function pdfPageAtOffset(
  layout: ReturnType<typeof pdfPageLayout>,
  offset: number,
) {
  let low = 0,
    high = layout.pages.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (layout.pages[mid].top <= offset) low = mid;
    else high = mid - 1;
  }
  // Prefer the left page when both pages share a row.
  while (low > 0 && layout.pages[low - 1].top === layout.pages[low].top) low--;
  return layout.pages[low];
}
