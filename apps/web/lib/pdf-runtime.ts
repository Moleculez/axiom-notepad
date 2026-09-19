/** Prepared by npm run tools:assets and production builds. Never uses a CDN. */
export const pdfRuntimeOptions = {
  cMapUrl: "/tool-assets/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/tool-assets/pdfjs/standard_fonts/",
  wasmUrl: "/tool-assets/pdfjs/wasm/",
  enableXfa: false,
  isEvalSupported: false,
} as const;
