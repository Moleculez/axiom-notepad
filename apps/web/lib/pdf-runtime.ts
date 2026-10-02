/** Prepared by npm run tools:assets and production builds. Never uses a CDN. */
import { runtimeAsset } from "./runtime-assets";
export const pdfRuntimeOptions = {
  cMapUrl: runtimeAsset("tool-assets/pdfjs/cmaps/"),
  cMapPacked: true,
  standardFontDataUrl: runtimeAsset("tool-assets/pdfjs/standard_fonts/"),
  wasmUrl: runtimeAsset("tool-assets/pdfjs/wasm/"),
  enableXfa: false,
  isEvalSupported: false,
} as const;
