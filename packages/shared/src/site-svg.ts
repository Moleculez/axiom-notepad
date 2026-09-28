import { DOMParser } from "@xmldom/xmldom";
import { escapeHtml } from "@axiom/markdown";

/** Conservative rasterization input. No script, foreignObject, CSS, images,
 * entities, processing instructions or external/file references reach librsvg. */
export function publicationSvg(bytes: Uint8Array): Buffer {
  const source = new TextDecoder().decode(bytes);
  if (source.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(source))
    throw new Error(
      "SVG is too large or contains unsupported XML declarations.",
    );
  const errors: string[] = [];
  const doc = new DOMParser({
    onError: (_level, message) => {
      errors.push(message);
    },
  }).parseFromString(source, "image/svg+xml");
  if (errors.length || doc.documentElement?.localName !== "svg")
    throw new Error("This SVG could not be safely read.");
  const tags = new Set([
    "svg",
    "g",
    "defs",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "title",
    "desc",
    "linearGradient",
    "radialGradient",
    "stop",
    "clipPath",
    "mask",
    "pattern",
    "use",
    "symbol",
  ]);
  const attrs = new Set([
    "id",
    "viewBox",
    "width",
    "height",
    "x",
    "y",
    "x1",
    "y1",
    "x2",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "d",
    "points",
    "transform",
    "fill",
    "fill-rule",
    "fill-opacity",
    "stroke",
    "stroke-width",
    "stroke-opacity",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-dasharray",
    "stroke-dashoffset",
    "opacity",
    "offset",
    "stop-color",
    "stop-opacity",
    "gradientUnits",
    "gradientTransform",
    "spreadMethod",
    "clip-path",
    "clipPathUnits",
    "mask",
    "maskUnits",
    "patternUnits",
    "patternTransform",
    "preserveAspectRatio",
    "font-size",
    "font-family",
    "font-weight",
    "text-anchor",
    "dominant-baseline",
    "dx",
    "dy",
    "href",
  ]);
  let count = 0;
  function visit(node: import("@xmldom/xmldom").Node): string {
    if (++count > 20000) throw new Error("SVG contains too many elements.");
    if (node.nodeType === 3 || node.nodeType === 4)
      return escapeHtml(node.nodeValue ?? "");
    if (node.nodeType !== 1) return "";
    const element = node as import("@xmldom/xmldom").Element;
    if (
      !element.localName ||
      !tags.has(element.localName) ||
      (element.namespaceURI &&
        element.namespaceURI !== "http://www.w3.org/2000/svg")
    )
      return "";
    const attributes: string[] = [];
    for (let i = 0; i < element.attributes.length; i++) {
      const attr = element.attributes.item(i)!;
      if (
        !attr.localName ||
        !attrs.has(attr.localName) ||
        attr.value.length > 200000 ||
        /[\\\u0000-\u001f]/.test(attr.value)
      )
        continue;
      if (attr.localName === "href" && !/^#[\w.-]+$/.test(attr.value)) continue;
      if (/url\s*\(/i.test(attr.value) && !/^url\(#[\w.-]+\)$/.test(attr.value))
        continue;
      attributes.push(`${attr.localName}="${escapeHtml(attr.value)}"`);
    }
    let children = "";
    for (let child = node.firstChild; child; child = child.nextSibling)
      children += visit(child);
    return `<${element.localName}${element === doc.documentElement ? ' xmlns="http://www.w3.org/2000/svg"' : ""} ${attributes.join(" ")}>${children}</${element.localName}>`;
  }
  return Buffer.from(visit(doc.documentElement));
}
