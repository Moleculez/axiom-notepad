import JSZip from "jszip";
import ExcelJS from "exceljs";
const header = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const relNs = "http://schemas.openxmlformats.org/package/2006/relationships";
const officeNs =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const contentNs =
  "http://schemas.openxmlformats.org/package/2006/content-types";
export async function officeTemplate(type: "docx" | "xlsx" | "pptx") {
  if (type === "xlsx") {
    const book = new ExcelJS.Workbook();
    book.creator = "Axiom";
    book.addWorksheet("Sheet1");
    return {
      data: Buffer.from(await book.xlsx.writeBuffer()),
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  }
  const zip = new JSZip(),
    entries: [string, string, string][] = [];
  if (type === "docx") {
    entries.push([
      "word/document.xml",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`,
    ]);
  } else {
    const p = "http://schemas.openxmlformats.org/presentationml/2006/main",
      a = "http://schemas.openxmlformats.org/drawingml/2006/main";
    const tree = `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>`;
    const colorMap =
      'accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"';
    entries.push(
      [
        "ppt/presentation.xml",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
        `<p:presentation xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${officeNs}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId2"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
      ],
      [
        "ppt/slides/slide1.xml",
        "application/vnd.openxmlformats-officedocument.presentationml.slide+xml",
        `<p:sld xmlns:p="${p}" xmlns:a="${a}"><p:cSld name="Blank slide">${tree}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
      ],
      [
        "ppt/slideLayouts/slideLayout1.xml",
        "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml",
        `<p:sldLayout xmlns:p="${p}" xmlns:a="${a}" type="blank" preserve="1"><p:cSld name="Blank">${tree}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
      ],
      [
        "ppt/slideMasters/slideMaster1.xml",
        "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml",
        `<p:sldMaster xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${officeNs}"><p:cSld>${tree}</p:cSld><p:clrMap ${colorMap}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`,
      ],
      [
        "ppt/theme/theme1.xml",
        "application/vnd.openxmlformats-officedocument.theme+xml",
        `<a:theme xmlns:a="${a}" name="Axiom"><a:themeElements><a:clrScheme name="Research">${Object.entries(
          {
            dk1: "202124",
            lt1: "FFFFFF",
            dk2: "334155",
            lt2: "F1F5F9",
            accent1: "5471A6",
            accent2: "61966B",
            accent3: "B49B3B",
            accent4: "9771BB",
            accent5: "508EA6",
            accent6: "C85D62",
            hlink: "2563EB",
            folHlink: "7C3AED",
          },
        )
          .map(([k, v]) => `<a:${k}><a:srgbClr val="${v}"/></a:${k}>`)
          .join(
            "",
          )} </a:clrScheme><a:fontScheme name="Research"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Research"><a:fillStyleLst>${[0, 1, 2].map(() => '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>').join("")}</a:fillStyleLst><a:lnStyleLst>${[6350, 12700, 19050].map((w) => `<a:ln w="${w}"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>`).join("")}</a:lnStyleLst><a:effectStyleLst>${[0, 1, 2].map(() => "<a:effectStyle><a:effectLst/></a:effectStyle>").join("")}</a:effectStyleLst><a:bgFillStyleLst>${[0, 1, 2].map(() => '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>').join("")}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`,
      ],
    );
    const rels = (path: string, values: [string, string][]) =>
      zip.file(
        path,
        header +
          `<Relationships xmlns="${relNs}">${values.map(([type, target], i) => `<Relationship Id="rId${i + 1}" Type="${officeNs}/${type}" Target="${target}"/>`).join("")}</Relationships>`,
      );
    rels("ppt/_rels/presentation.xml.rels", [
      ["slide", "slides/slide1.xml"],
      ["slideMaster", "slideMasters/slideMaster1.xml"],
    ]);
    rels("ppt/slides/_rels/slide1.xml.rels", [
      ["slideLayout", "../slideLayouts/slideLayout1.xml"],
    ]);
    rels("ppt/slideLayouts/_rels/slideLayout1.xml.rels", [
      ["slideMaster", "../slideMasters/slideMaster1.xml"],
    ]);
    rels("ppt/slideMasters/_rels/slideMaster1.xml.rels", [
      ["slideLayout", "../slideLayouts/slideLayout1.xml"],
      ["theme", "../theme/theme1.xml"],
    ]);
  }
  for (const [path, , body] of entries) zip.file(path, header + body);
  zip.file(
    "[Content_Types].xml",
    header +
      `<Types xmlns="${contentNs}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${entries.map(([path, type]) => `<Override PartName="/${path}" ContentType="${type}"/>`).join("")}</Types>`,
  );
  zip.file(
    "_rels/.rels",
    header +
      `<Relationships xmlns="${relNs}"><Relationship Id="rId1" Type="${officeNs}/officeDocument" Target="${entries[0][0]}"/></Relationships>`,
  );
  return {
    data: await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    }),
    mime: `application/vnd.openxmlformats-officedocument.${type === "docx" ? "wordprocessingml.document" : "presentationml.presentation"}`,
  };
}
