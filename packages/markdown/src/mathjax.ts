import { mathjax } from "@mathjax/src/mjs/mathjax.js";
import { TeX } from "@mathjax/src/mjs/input/tex.js";
import { SVG } from "@mathjax/src/mjs/output/svg.js";
import { liteAdaptor } from "@mathjax/src/mjs/adaptors/liteAdaptor.js";
import type { LiteElement } from "@mathjax/src/mjs/adaptors/lite/Element.js";
import { RegisterHTMLHandler } from "@mathjax/src/mjs/handlers/html.js";
import { SafeHandler } from "@mathjax/src/mjs/ui/safe/SafeHandler.js";
import { AssistiveMmlHandler } from "@mathjax/src/mjs/a11y/assistive-mml.js";
import { MathJaxNewcmFont } from "@mathjax/mathjax-newcm-font/mjs/svg.js";
import { MathJaxMhchemFontExtension } from "@mathjax/mathjax-mhchem-font-extension/mjs/svg.js";
import "@mathjax/src/mjs/input/tex/ams/AmsConfiguration.js";
import "@mathjax/src/mjs/input/tex/newcommand/NewcommandConfiguration.js";
import "@mathjax/src/mjs/input/tex/configmacros/ConfigMacrosConfiguration.js";
import "@mathjax/src/mjs/input/tex/mathtools/MathtoolsConfiguration.js";
import "@mathjax/src/mjs/input/tex/boldsymbol/BoldsymbolConfiguration.js";
import "@mathjax/src/mjs/input/tex/braket/BraketConfiguration.js";
import "@mathjax/src/mjs/input/tex/cancel/CancelConfiguration.js";
import "@mathjax/src/mjs/input/tex/color/ColorConfiguration.js";
import "@mathjax/src/mjs/input/tex/mhchem/MhchemConfiguration.js";
import "@mathjax/src/mjs/input/tex/physics/PhysicsConfiguration.js";
import "./math-fonts";
import {
  MATH_INPUT_LIMIT,
  type MathRequest,
  type MathResult,
} from "./math-contract";
import { escapeHtml } from "./render";

const adaptor = liteAdaptor({ fontSize: 16 });
AssistiveMmlHandler(SafeHandler(RegisterHTMLHandler(adaptor)));
class BundledNewcmFont extends MathJaxNewcmFont {
  preload() {
    for (const file of Object.values(BundledNewcmFont.dynamicFiles))
      file.setup(this);
  }
}
const font = new BundledNewcmFont();
font.preload();
font.addExtension(MathJaxMhchemFontExtension);
// Never permit dynamic loads, even if a future package accidentally asks for one.
mathjax.asyncLoad = () =>
  Promise.reject(new Error("External math resources are disabled."));
let stylesheet = "";
export function renderMath(request: MathRequest): MathResult {
  try {
    if (
      typeof request.tex !== "string" ||
      !Array.isArray(request.macros) ||
      request.macros.some((m) => typeof m !== "string")
    )
      throw new Error("Invalid math request.");
    const source = request.macros.join("\n") + "\n" + request.tex;
    if (source.length > MATH_INPUT_LIMIT || request.macros.length > 200)
      throw new Error(
        "This expression exceeds the 30 KB rendering limit. The TeX source is preserved.",
      );
    const tex = source.replace(/\\require\s*\{([^}]+)\}/g, (_match, name) => {
      if (
        !["ams", "mhchem", "physics"].includes(name) ||
        (name === "physics" && !request.physics)
      )
        throw new Error(
          `Unsupported TeX package: ${name}. Only bundled AMS, mhchem and opt-in physics are allowed.`,
        );
      return "";
    });
    // Fresh input state for EVERY expression: definitions cannot escape their
    // document or poison another account, including after a failed compilation.
    const input = new TeX({
      packages: [
        "base",
        "ams",
        "newcommand",
        "configmacros",
        "mathtools",
        "boldsymbol",
        "braket",
        "cancel",
        "color",
        "mhchem",
        ...(request.physics ? ["physics"] : []),
      ],
      macros: { R: "\\mathbb{R}", N: "\\mathbb{N}", E: "\\mathbb{E}" },
      maxBuffer: MATH_INPUT_LIMIT,
      maxMacros: 500,
      maxTemplateSubtitutions: 1000,
      tags: "none",
      formatError: (_jax: unknown, error: Error) => {
        throw error;
      },
    });
    const output = new SVG({
      fontData: font,
      fontCache: "none",
      useXlink: false,
      mtextInheritFont: false,
      unknownFamily: "serif",
    });
    const document = mathjax.document("", {
      InputJax: input,
      OutputJax: output,
      enableAssistiveMml: true,
      safeOptions: {
        allow: {
          URLs: "none",
          classes: "none",
          cssIDs: "none",
          styles: "none",
        },
        safeProtocols: {
          http: false,
          https: false,
          file: false,
          javascript: false,
          data: false,
        },
        lengthMax: 20,
        scriptlevelRange: [-2, 4],
      },
      compileError: (_document: unknown, _math: unknown, error: Error) => {
        throw error;
      },
      typesetError: (_document: unknown, _math: unknown, error: Error) => {
        throw error;
      },
    });
    const node = document.convert(tex, {
      display: request.display,
      em: 16,
      ex: 8,
      containerWidth: 1152,
    });
    const html = adaptor.outerHTML(node as LiteElement);
    if (html.length > 2_000_000)
      throw new Error(
        "Rendered equation is too large. The TeX source is preserved.",
      );
    stylesheet ||= adaptor.cssText(output.styleSheet(document) as LiteElement);
    return { html, css: stylesheet };
  } catch (error) {
    const message =
      error && typeof error === "object" && "message" in error
        ? String(error.message)
        : "Invalid TeX expression.";
    return {
      html: `<span class="math-error" role="status" title="${escapeHtml(message)}">${escapeHtml(request.tex ?? "")}</span>`,
      css: stylesheet,
      error: message,
    };
  }
}
