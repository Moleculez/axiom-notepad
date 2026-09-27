/** Rasterize the actual browser export and check its selectable text without
 * requiring a system Poppler installation. Artifacts stay beside the test PDF. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const path = resolve(process.argv[2] ?? "");
if (!path.endsWith(".pdf"))
  throw new Error("Pass a browser-exported PDF path.");
const loading = getDocument({
  data: new Uint8Array(await readFile(path)),
  useSystemFonts: false,
});
const pdf = await loading.promise;
const pages = pdf.numPages;
let text = "";
for (let number = 1; number <= pages; number++) {
  const page = await pdf.getPage(number);
  text +=
    (await page.getTextContent()).items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ") + "\n";
  const viewport = page.getViewport({ scale: 1.5 });
  const factory = pdf.canvasFactory as {
    create: (
      width: number,
      height: number,
    ) => {
      canvas: HTMLCanvasElement & { toBuffer: (type: string) => Buffer };
      context: CanvasRenderingContext2D;
    };
    destroy: (target: unknown) => void;
  };
  const surface = factory.create(
    Math.ceil(viewport.width),
    Math.ceil(viewport.height),
  );
  await page.render({
    canvas: surface.canvas,
    canvasContext: surface.context,
    viewport,
  }).promise;
  const image = path.replace(/\.pdf$/, `-page-${number}.png`);
  await writeFile(image, surface.canvas.toBuffer("image/png"));
  factory.destroy(surface);
  console.log(image);
}
await loading.destroy();
if (!text.trim()) throw new Error("Export has no selectable text.");
if (process.argv[3] && !text.includes(process.argv[3]))
  throw new Error(`Expected selectable text was missing: ${process.argv[3]}`);
console.log(
  `Verified ${pages} pages and ${text.length} characters of selectable text.`,
);
