import JSZip from "jszip";
const escape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
/** Bounded presentation-MathML to editable Office Math. Unsupported constructs
 * fail explicitly; a bitmap is never passed off as editable mathematics. */
export function mathMLToOMML(math: Element) {
  let count = 0;
  const convert = (node: Element): string => {
    if (++count > 10000)
      throw new Error("Equation is too large for editable Office export.");
    const children = Array.from(node.children),
      body = () => children.map(convert).join(""),
      part = (i: number) => (children[i] ? convert(children[i]) : ""),
      run = (text: string) =>
        `<m:r><m:t xml:space="preserve">${escape(text)}</m:t></m:r>`;
    switch (node.localName) {
      case "math":
      case "mrow":
      case "mstyle":
      case "mpadded":
        return body();
      case "semantics":
        return part(0);
      case "mi":
      case "mn":
      case "mo":
      case "mtext":
      case "ms":
        return run(node.textContent ?? "");
      case "mspace":
        return run(" ");
      case "mfrac":
        return `<m:f><m:num>${part(0)}</m:num><m:den>${part(1)}</m:den></m:f>`;
      case "msqrt":
        return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${body()}</m:e></m:rad>`;
      case "mroot":
        return `<m:rad><m:deg>${part(1)}</m:deg><m:e>${part(0)}</m:e></m:rad>`;
      case "msub":
        return `<m:sSub><m:e>${part(0)}</m:e><m:sub>${part(1)}</m:sub></m:sSub>`;
      case "msup":
        return `<m:sSup><m:e>${part(0)}</m:e><m:sup>${part(1)}</m:sup></m:sSup>`;
      case "msubsup":
        return `<m:sSubSup><m:e>${part(0)}</m:e><m:sub>${part(1)}</m:sub><m:sup>${part(2)}</m:sup></m:sSubSup>`;
      case "munder":
        return `<m:limLow><m:e>${part(0)}</m:e><m:lim>${part(1)}</m:lim></m:limLow>`;
      case "mover":
        return node.getAttribute("accent") === "true" &&
          children[1]?.textContent?.length === 1
          ? `<m:acc><m:accPr><m:chr m:val="${escape(children[1].textContent)}"/></m:accPr><m:e>${part(0)}</m:e></m:acc>`
          : `<m:limUpp><m:e>${part(0)}</m:e><m:lim>${part(1)}</m:lim></m:limUpp>`;
      case "munderover":
        return `<m:limUpp><m:e><m:limLow><m:e>${part(0)}</m:e><m:lim>${part(1)}</m:lim></m:limLow></m:e><m:lim>${part(2)}</m:lim></m:limUpp>`;
      case "mtable":
        return `<m:m>${body()}</m:m>`;
      case "mtr":
        return `<m:mr>${body()}</m:mr>`;
      case "mtd":
        return `<m:e>${body()}</m:e>`;
      case "mfenced":
        return (
          run(node.getAttribute("open") ?? "(") +
          body() +
          run(node.getAttribute("close") ?? ")")
        );
      case "annotation":
      case "annotation-xml":
        return "";
      default:
        throw new Error(
          `Editable Office export does not support ${node.localName}. Export SVG/PNG or LaTeX to preserve this expression exactly.`,
        );
    }
  };
  return `<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${convert(math)}</m:oMath>`;
}
export async function mathDocx(math: Element, source: string) {
  const omml = mathMLToOMML(math),
    zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body><w:p><m:oMathPara>${omml}</m:oMathPara></w:p><w:p><w:r><w:t>LaTeX source</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">${escape(source)}</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`,
  );
  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}
