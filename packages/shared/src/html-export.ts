import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fonts, type Preferences } from "./appearance";
import { escapeHtml, parseMarkdown, type RenderContext } from "@axiom/markdown";
import { renderDocumentAsync } from "../../markdown/src/render-async";

let style: Promise<string> | undefined;
let decorationsStyle: Promise<string> | undefined;
let tasksStyle: Promise<string> | undefined;
function documentTasksStyle() {
  const requireAsset = createRequire(`${process.cwd()}/package.json`);
  return (tasksStyle ??= readFile(
    join(
      dirname(requireAsset.resolve("@axiom/shared/appearance")),
      "../assets/document-tasks.css",
    ),
    "utf8",
  ));
}
function documentDecorationsStyle() {
  const requireAsset = createRequire(`${process.cwd()}/package.json`);
  return (decorationsStyle ??= readFile(
    join(
      dirname(requireAsset.resolve("@axiom/shared/appearance")),
      "../assets/document-decorations.css",
    ),
    "utf8",
  ));
}
const embeddedFonts = new Map<string, Promise<string>>();
async function readingStyle(p: Preferences) {
  const packages: Record<string, string> = {
    inter: "inter",
    sourceSans: "source-sans-3",
    sourceSerif: "source-serif-4",
    atkinson: "atkinson-hyperlegible",
    jetbrains: "jetbrains-mono",
    plexMono: "ibm-plex-mono",
  };
  const selected = new Set([
    `${p.proseFont}:${p.proseWeight}`,
    `${p.headingFont}:${p.headingWeight}`,
    `${p.codeFont}:${p.codeWeight}`,
    `${p.proseFont}:700`,
    `${p.proseFont}:400-italic`,
  ]);
  const css: string[] = [];
  let includedLatinModern = false;
  for (const item of selected) {
    const [id, requestedWeight] = item.split(":");
    if (id === "latinModern") {
      if (includedLatinModern) continue;
      includedLatinModern = true;
      let cached = embeddedFonts.get("latinModern");
      if (!cached) {
        cached = (async () => {
          const requireAsset = createRequire(`${process.cwd()}/package.json`);
          const root = join(
            dirname(requireAsset.resolve("@axiom/shared/appearance")),
            "../assets/latin-modern",
          );
          let source = await readFile(join(root, "fonts.css"), "utf8");
          for (const match of [
            ...source.matchAll(/url\("(\.\/axiom-lm-[a-z]+\.woff2)"\)/g),
          ])
            source = source.replace(
              match[0],
              `url(data:font/woff2;base64,${(await readFile(join(root, match[1]))).toString("base64")})`,
            );
          const license = await readFile(join(root, "LICENSE.txt"), "utf8");
          return (
            `/* Latin Modern by GUST; Axiom web-format conversion. ${license.replace(/\*\//g, "* /")} */\n` +
            source
          );
        })();
        embeddedFonts.set("latinModern", cached);
      }
      css.push(await cached);
      continue;
    }
    const pkg = packages[id];
    if (!pkg) continue;
    const weight =
        id === "atkinson" && ["500", "600"].includes(requestedWeight)
          ? "700"
          : requestedWeight,
      key = pkg + ":" + weight;
    let cached = embeddedFonts.get(key);
    if (!cached) {
      cached = (async () => {
        const requireAsset = createRequire(`${process.cwd()}/package.json`),
          file = requireAsset.resolve(`@fontsource/${pkg}/${weight}.css`),
          root = dirname(file);
        let source = await readFile(file, "utf8");
        for (const match of [
          ...source.matchAll(/src:\s*url\((\.\/files\/[^)]+\.woff2)\)[^;]+;/g),
        ])
          source = source.replace(
            match[0],
            `src:url(data:font/woff2;base64,${(await readFile(join(root, match[1]))).toString("base64")}) format('woff2');`,
          );
        const license = await readFile(join(root, "LICENSE"), "utf8");
        return `/* ${license.replace(/\*\//g, "* /")} */\n` + source;
      })();
      embeddedFonts.set(key, cached);
    }
    css.push(await cached);
  }
  return (
    css.join("\n") +
    `body{font-family:${fonts[p.proseFont].family};font-size:${p.proseSize}px;font-weight:${p.proseWeight};line-height:${p.lineHeight};letter-spacing:${p.letterSpacing}em;word-spacing:${p.wordSpacing}em;max-width:${p.fullWidth ? "100%" : p.readingWidth + "ch"}}p{margin-bottom:${p.paragraphSpacing}em}h1,h2,h3,h4,h5,h6{font-family:${fonts[p.headingFont].family};font-weight:${p.headingWeight};line-height:1.35;letter-spacing:-.02em}h1{font-size:${2 * p.headingScale}em}h2{font-size:${1.6 * p.headingScale}em}h3{font-size:${1.3 * p.headingScale}em}h4,h5,h6{font-size:${1.1 * p.headingScale}em}code,pre{font-family:${fonts[p.codeFont].family};font-size:${p.codeSize}px;font-weight:${p.codeWeight}}pre,pre code{white-space:${p.codeWrap ? "pre-wrap" : "pre"}}.math-block,.math-inline{font-size:${p.mathScale}em}`
  );
}
function exportStyle() {
  return (style ??= (async () => {
    const requireAsset = createRequire(`${process.cwd()}/package.json`);
    const mathLicense = await readFile(
      requireAsset.resolve("@mathjax/src/LICENSE"),
      "utf8",
    );
    return `${await documentTasksStyle()}\n/* MathJax and MathJax New Computer Modern / mhchem SVG fonts: Apache-2.0.
      ${mathLicense.replace(/\*\//g, "* /")}
      */
      *{box-sizing:border-box}body{max-width:850px;margin:60px auto;padding:0 32px;color:#27382f;background:#fff;font:18px/1.8 Georgia,serif}
      h1,h2,h3,h4,h5,h6{line-height:1.3;break-after:avoid}h1{font-size:2.2em}h2{margin-top:2em}a{color:#386850;text-underline-offset:3px}
      code,pre{font-family:ui-monospace,monospace;font-size:.85em}code{background:#f2f4f1;padding:2px 4px;border-radius:3px}pre{padding:20px;background:#f2f4f1;overflow:auto}pre code{padding:0}
      blockquote,.callout{margin:24px 0;padding:12px 24px;border-left:2px solid #b0b3ac;background:#fff}.callout-title{font-weight:bold}.callout p:last-child{margin-bottom:0}
      .table-scroll{max-width:100%;overflow-x:auto;margin:24px 0}table{width:100%;border-collapse:collapse;border-block:1.5px solid #65685f;font:inherit;font-size:.95em;line-height:1.5}td,th{padding:.65em .85em;border:0;font-variant-numeric:lining-nums tabular-nums}th{border-bottom:1px solid #cdcdc5;background:transparent}img{max-width:100%;height:auto}
      .math-block{position:relative;margin:24px 0;overflow:auto}.equation-number{position:absolute;right:0;top:50%;transform:translateY(-50%)}.math-block mjx-container{overflow:auto;padding:0 38px}
      .math-error,.unresolved{color:#a04732}.footnotes,.bibliography{font-size:.85em}.export-meta,footer{font:12px/1.6 system-ui,sans-serif;color:#657368}footer{margin-top:60px;padding-top:20px;border-top:1px solid #d9e1d9}
      mark{background:#f8edbd}.hljs-keyword,.hljs-literal{color:#855cad}.hljs-string{color:#447646}.hljs-comment{color:#778476}
      @media(max-width:600px){body{margin:24px auto;padding:0 18px;font-size:16px}}@media print{body{margin:0;max-width:none}pre{white-space:pre-wrap}.callout,table,.math-block{break-inside:avoid}a{color:inherit}}
    `;
  })());
}

export async function htmlExport(
  source: string,
  title: string,
  context: RenderContext,
  attachment: (
    id: string,
  ) => Promise<{ mime: string; data: Uint8Array } | undefined>,
  preferences?: Preferences,
) {
  const rendered = await renderDocumentAsync(parseMarkdown(source), {
    ...context,
    scrollTables: true,
  });
  let body = rendered.html;
  let imageBytes = 0;
  for (const match of [
    ...body.matchAll(/src="(\/api\/v1\/attachments\/([a-f0-9-]{36}))"/g),
  ]) {
    const file = await attachment(match[2]);
    if (!file || !/^image\/(png|jpeg|gif|webp)$/.test(file.mime)) continue;
    imageBytes += file.data.byteLength;
    if (imageBytes > 20 * 1024 * 1024)
      throw new Error(
        "HTML exports support up to 20 MB of images. Use the Markdown ZIP export for larger notes.",
      );
    body = body.replaceAll(
      match[0],
      `src="data:${file.mime};base64,${Buffer.from(file.data).toString("base64")}"`,
    );
  }
  return `<!doctype html><html lang="en" data-document-decorations="${preferences?.documentDecorations ?? "none"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data: https:"><title>${escapeHtml(title)}</title><style>${await exportStyle()}${rendered.css}${preferences ? await readingStyle(preferences) : ""}${preferences?.documentDecorations === "latex" ? await documentDecorationsStyle() : ""}</style></head><body><header><p class="export-meta">AXIOM · RESEARCH NOTE</p><h1>${escapeHtml(title)}</h1></header><main class="prose">${body}</main><footer>Exported from Axiom. Equations, tables, citations, and attached images are included. Diagram source is preserved; use Print / save as PDF for rendered diagrams. External images, linked PDFs, and other notes may require connectivity and group access.</footer></body></html>`;
}
