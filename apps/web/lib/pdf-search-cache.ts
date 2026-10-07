import type { PDFDocumentProxy } from "pdfjs-dist";

/** Only normalized search text, never PDF binaries, annotations or credentials. */
export class PdfSearchTextCache {
  private values = new Map<number, string>();
  private pending = new Map<number, Promise<string>>();
  private bytes = 0;
  private closed = false;
  constructor(
    private extract: (page: number) => Promise<string>,
    private maximumBytes = 16 * 1024 * 1024,
    private maximumPages = 256,
  ) {}
  get stats() {
    return {
      bytes: this.bytes,
      pages: this.values.size,
      pending: this.pending.size,
    };
  }
  get(page: number): Promise<string> {
    if (this.closed)
      return Promise.reject(new DOMException("PDF closed", "AbortError"));
    const value = this.values.get(page);
    if (value !== undefined) {
      this.values.delete(page);
      this.values.set(page, value);
      return Promise.resolve(value);
    }
    const existing = this.pending.get(page);
    if (existing) return existing;
    if (this.pending.size >= this.maximumPages)
      return Promise.reject(
        new Error("Too many PDF text requests are pending."),
      );
    const request = Promise.resolve()
      .then(() => this.extract(page))
      .then((text) => {
        if (this.closed) throw new DOMException("PDF closed", "AbortError");
        const size = text.length * 2;
        if (size <= this.maximumBytes) {
          while (
            this.values.size &&
            (this.values.size >= this.maximumPages ||
              this.bytes + size > this.maximumBytes)
          ) {
            const oldest = this.values.keys().next().value!;
            this.bytes -= this.values.get(oldest)!.length * 2;
            this.values.delete(oldest);
          }
          this.values.set(page, text);
          this.bytes += size;
        }
        return text;
      })
      .finally(() => this.pending.delete(page));
    this.pending.set(page, request);
    return request;
  }
  dispose() {
    this.closed = true;
    this.values.clear();
    this.pending.clear();
    this.bytes = 0;
  }
}

const documents = new WeakMap<PDFDocumentProxy, PdfSearchTextCache>();
const closed = new WeakSet<PDFDocumentProxy>();
export function pdfSearchText(pdf: PDFDocumentProxy, page: number) {
  if (closed.has(pdf))
    return Promise.reject(new DOMException("PDF closed", "AbortError"));
  let cache = documents.get(pdf);
  if (!cache) {
    cache = new PdfSearchTextCache(async (number) => {
      const content = await (await pdf.getPage(number)).getTextContent();
      return content.items
        .flatMap((item) => ("str" in item ? [item.str] : []))
        .join(" ");
    });
    documents.set(pdf, cache);
  }
  return cache.get(page);
}
export function closePdfSearchText(pdf: PDFDocumentProxy) {
  closed.add(pdf);
  documents.get(pdf)?.dispose();
  documents.delete(pdf);
}

/** Spans are source ordered; binary-search the first overlap, not every span
 * for every match. Empty spans and the join's separator remain unhighlighted. */
export function overlappingPdfSpans<T extends { start: number; text: string }>(
  spans: readonly T[],
  start: number,
  end: number,
): T[] {
  let low = 0,
    high = spans.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (spans[middle].start + spans[middle].text.length <= start)
      low = middle + 1;
    else high = middle;
  }
  const matches: T[] = [];
  for (let i = low; i < spans.length && spans[i].start < end; i++)
    if (spans[i].start + spans[i].text.length > start) matches.push(spans[i]);
  return matches;
}
