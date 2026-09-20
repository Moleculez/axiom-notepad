import { createRequire } from "node:module";
const JSZip = createRequire(import.meta.url)("jszip") as typeof import("jszip");
export async function wordFixture() {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
    <w:p><w:pPr><w:pStyle w:val="ResearchTitle"/></w:pPr><w:r><w:t>Energy &amp; evidence</w:t></w:r></w:p>
    <w:p><w:r><w:t>Observed alpha</w:t><w:tab/><w:t>β uncertainty.</w:t></w:r><w:del><w:r><w:delText>Deleted claim</w:delText></w:r></w:del></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Mass</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Energy</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Limitations</w:t></w:r></w:p>
    <w:p><w:r><w:t>Future work &lt;script&gt; remains inert.</w:t></w:r></w:p>
  </w:body></w:document>`,
  );
  zip.file(
    "word/styles.xml",
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:styleId="ResearchTitle"><w:name w:val="Study heading"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>',
  );
  zip.file(
    "word/comments.xml",
    '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="3" w:author="External researcher"><w:p><w:r><w:t>Check calibration</w:t></w:r></w:p></w:comment></w:comments>',
  );
  zip.file(
    "word/footnotes.xml",
    '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="-1" w:type="separator"/><w:footnote w:id="1"><w:p><w:r><w:t>Source measurement</w:t></w:r></w:p></w:footnote></w:footnotes>',
  );
  return zip;
}
export async function slidesFixture() {
  const zip = new JSZip(),
    ns =
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
  zip.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
  );
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation ${ns} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="301" r:id="second"/><p:sldId id="300" r:id="first"/></p:sldIdLst></p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="first" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="second" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>',
  );
  for (const [index, title] of [
    [1, "Appendix"],
    [2, "Research results"],
  ] as const)
    zip.file(
      `ppt/slides/slide${index}.xml`,
      `<p:sld ${ns} ${index === 1 ? 'show="0"' : ""}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:txBody><a:p><a:r><a:t>Evidence ${index}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    );
  zip.file(
    "ppt/slides/_rels/slide2.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="notes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/><Relationship Id="external" Type="image" TargetMode="External" Target="https://invalid.example/never-fetch"/></Relationships>',
  );
  zip.file(
    "ppt/notesSlides/notesSlide1.xml",
    `<p:notes ${ns}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Explain the calibration uncertainty.</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>42</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`,
  );
  return zip;
}
