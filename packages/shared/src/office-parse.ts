import JSZip from "jszip";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { decodeXML } from "entities";
import type {
  OfficeSnapshot,
  OfficeBlock,
  OfficeParagraph,
} from "@axiom/shared/office-preview";

type Node = { [key: string]: Node[] | Record<string, string> | string };
const tag = (node: Node) => Object.keys(node).find((key) => key !== ":@") ?? "";
const children = (node: Node): Node[] =>
  Array.isArray(node[tag(node)]) ? (node[tag(node)] as Node[]) : [];
const attr = (node: Node, key: string) =>
  decodeXML(
    String(
      (node[":@"] as Record<string, string> | undefined)?.[`@_${key}`] ?? "",
    ),
  );
function descendants(nodes: Node[], name: string): Node[] {
  const found: Node[] = [],
    stack = [...nodes].reverse();
  while (stack.length) {
    const node = stack.pop()!;
    if (tag(node) === name) found.push(node);
    for (let i = children(node).length - 1; i >= 0; i--)
      stack.push(children(node)[i]);
  }
  return found;
}
function text(nodes: Node[]): string {
  const result: string[] = [],
    stack = [...nodes].reverse();
  while (stack.length) {
    const node = stack.pop()!,
      name = tag(node);
    if (["w:del", "w:instrText", "w:delText"].includes(name)) continue;
    if (["w:t", "a:t"].includes(name)) {
      result.push(
        children(node)
          .map((child) => decodeXML(String(child["#text"] ?? "")))
          .join(""),
      );
      continue;
    }
    if (["w:br", "a:br", "w:cr"].includes(name)) {
      result.push("\n");
      continue;
    }
    if (name === "w:tab") {
      result.push("\t");
      continue;
    }
    for (let i = children(node).length - 1; i >= 0; i--)
      stack.push(children(node)[i]);
  }
  return result.join("");
}
/** Resolve only internal package parts. Relationships never cause network access. */
function relatedPart(base: string, target: string) {
  if (!target || /[\\\u0000-\u001f?#:]|^\/\//.test(target)) return null;
  const path: string[] = target.startsWith("/")
    ? []
    : base.split("/").slice(0, -1);
  for (const piece of target.split("/")) {
    if (!piece || piece === ".") continue;
    if (piece === "..") {
      if (!path.length) return null;
      path.pop();
    } else path.push(piece);
  }
  return path.join("/");
}
export async function readOffice(
  data: ArrayBuffer,
  format: "docx" | "pptx",
): Promise<OfficeSnapshot> {
  if (data.byteLength > 50_000_000)
    throw new Error("Office reading view is limited to 50 MB.");
  const archive = await JSZip.loadAsync(data);
  let expanded = 0,
    entries = 0,
    characters = 0,
    blockCount = 0,
    tableCells = 0;
  for (const entry of Object.values(archive.files)) {
    const unsafe =
      (entry as typeof entry & { unsafeOriginalName?: string })
        .unsafeOriginalName ?? entry.name;
    expanded +=
      (entry as typeof entry & { _data?: { uncompressedSize?: number } })._data
        ?.uncompressedSize ?? 0;
    if (
      ++entries > 20000 ||
      expanded > 200_000_000 ||
      /(^|[\/\\])\.\.([\/\\]|$)|^[/\\]/.test(unsafe)
    )
      throw new Error(
        "This Office archive exceeds safe expansion limits or contains unsafe paths.",
      );
    if (/vbaProject|embeddings\//i.test(entry.name))
      throw new Error(
        "Macro-bearing documents and embedded objects are not previewed.",
      );
  }
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    processEntities: false,
    trimValues: false,
    parseTagValue: false,
    parseAttributeValue: false,
  });
  const xml = async (path: string, required = false): Promise<Node[]> => {
    const entry = archive.file(path);
    if (!entry) {
      if (required) throw new Error(`This document is missing ${path}.`);
      return [];
    }
    const size =
      (entry as typeof entry & { _data?: { uncompressedSize?: number } })._data
        ?.uncompressedSize ?? 0;
    if (size > 12_000_000)
      throw new Error("A document part exceeds the 12 MB reading limit.");
    const value = await entry.async("string");
    if (value.length > 12_000_000 || /<!DOCTYPE|<!ENTITY/i.test(value))
      throw new Error("Unsafe or oversized XML is not supported.");
    if (XMLValidator.validate(value) !== true)
      throw new Error("This document contains malformed XML.");
    return parser.parse(value) as Node[];
  };
  await xml("[Content_Types].xml", true);
  const result: OfficeSnapshot = {
    format,
    blocks: [],
    slides: [],
    comments: [],
    footnotes: [],
    warnings: [
      "Reading view extracts text only. Images, equations, charts, exact numbering, and original layout require a private page preview or the original application.",
    ],
  };
  const budget = (value: string) => {
    characters += value.length;
    if (characters > 5_000_000 || value.length > 500000)
      throw new Error("This document exceeds the safe reading text budget.");
    return value;
  };
  const nextId = () => {
    if (++blockCount > 20000)
      throw new Error(
        "This document has too many text blocks for reading view.",
      );
    return `block-${blockCount}`;
  };
  const wordStyles = new Map<string, number>();
  for (const style of descendants(await xml("word/styles.xml"), "w:style")) {
    const level = descendants(children(style), "w:outlineLvl")[0],
      name = descendants(children(style), "w:name")[0];
    const heading = level
      ? Number(attr(level, "w:val")) + 1
      : Number(
          /heading\s*([1-6])/i.exec(
            name ? attr(name, "w:val") : attr(style, "w:styleId"),
          )?.[1],
        );
    if (heading >= 1 && heading <= 6)
      wordStyles.set(attr(style, "w:styleId"), heading);
  }
  function wordBlocks(nodes: Node[]): OfficeBlock[] {
    const blocks: OfficeBlock[] = [];
    for (const node of nodes) {
      if (tag(node) === "w:p") {
        const content = budget(text(children(node))),
          style = descendants(children(node), "w:pStyle")[0],
          level = descendants(children(node), "w:outlineLvl")[0];
        const heading = level
          ? Number(attr(level, "w:val")) + 1
          : style
            ? (wordStyles.get(attr(style, "w:val")) ??
              Number(/^Heading([1-6])$/i.exec(attr(style, "w:val"))?.[1]))
            : undefined;
        if (content.trim())
          blocks.push({
            kind: "paragraph",
            id: nextId(),
            text: content,
            ...(heading && heading >= 1 && heading <= 6 ? { heading } : {}),
            ...(descendants(children(node), "w:numPr").length
              ? { list: true }
              : {}),
          });
      } else if (tag(node) === "w:tbl") {
        const rows = children(node)
          .filter((n) => tag(n) === "w:tr")
          .map((row) =>
            children(row)
              .filter((n) => tag(n) === "w:tc")
              .map((cell) => {
                if (++tableCells > 100000)
                  throw new Error("This document has too many table cells.");
                return budget(
                  descendants(children(cell), "w:p")
                    .map((p) => text(children(p)))
                    .join("\n"),
                );
              }),
          );
        blocks.push({ kind: "table", id: nextId(), rows });
      } else if (!["w:del", "w:sectPr", "w:altChunk"].includes(tag(node)))
        blocks.push(...wordBlocks(children(node)));
    }
    return blocks;
  }
  if (format === "docx") {
    const body = descendants(await xml("word/document.xml", true), "w:body")[0];
    if (!body) throw new Error("This Word document has no document body.");
    result.blocks = wordBlocks(children(body));
    for (const comment of descendants(
      await xml("word/comments.xml"),
      "w:comment",
    )) {
      if (result.comments.length >= 5000)
        throw new Error("This document has too many comments.");
      result.comments.push({
        id: attr(comment, "w:id"),
        author: budget(attr(comment, "w:author")),
        text: budget(
          descendants(children(comment), "w:p")
            .map((p) => text(children(p)))
            .join("\n"),
        ),
      });
    }
    for (const part of ["footnotes", "endnotes"])
      for (const note of descendants(
        await xml(`word/${part}.xml`),
        `w:${part.slice(0, -1)}`,
      )) {
        if (attr(note, "w:type") || Number(attr(note, "w:id")) < 1) continue;
        if (result.footnotes.length >= 5000)
          throw new Error("This document has too many footnotes.");
        result.footnotes.push({
          id: `${part === "footnotes" ? "Footnote" : "Endnote"} ${attr(note, "w:id")}`,
          text: budget(
            descendants(children(note), "w:p")
              .map((p) => text(children(p)))
              .join("\n"),
          ),
        });
      }
  } else {
    const relationships = async (base: string) => {
      const split = base.lastIndexOf("/"),
        path = `${base.slice(0, split + 1)}_rels/${base.slice(split + 1)}.rels`,
        map = new Map<string, { path: string; type: string }>();
      for (const node of descendants(await xml(path), "Relationship")) {
        if (attr(node, "TargetMode").toLowerCase() === "external") continue;
        const target = relatedPart(base, attr(node, "Target"));
        if (target)
          map.set(attr(node, "Id"), { path: target, type: attr(node, "Type") });
      }
      return map;
    };
    const presentation = await xml("ppt/presentation.xml", true),
      rels = await relationships("ppt/presentation.xml");
    const ids = descendants(presentation, "p:sldId");
    if (ids.length > 1000)
      throw new Error(
        "Presentations are limited to 1,000 slides in reading view.",
      );
    for (const node of ids) {
      const part = rels.get(attr(node, "r:id"));
      if (!part || !part.type.endsWith("/slide"))
        throw new Error("A slide relationship is missing or unsupported.");
      const slide = await xml(part.path, true),
        blocks: OfficeParagraph[] = [];
      for (const p of descendants(slide, "a:p")) {
        const content = budget(text(children(p)));
        if (content.trim())
          blocks.push({ kind: "paragraph", id: nextId(), text: content });
      }
      const titleShape = descendants(slide, "p:sp").find((shape) =>
        descendants(children(shape), "p:ph").some((ph) =>
          ["title", "ctrTitle"].includes(attr(ph, "type")),
        ),
      );
      const title =
        (titleShape
          ? descendants(children(titleShape), "a:p")
              .map((p) => text(children(p)))
              .join(" ")
          : blocks[0]?.text
        )?.slice(0, 300) || `Slide ${result.slides.length + 1}`;
      const slideRels = await relationships(part.path),
        notesPart = [...slideRels.values()].find((r) =>
          r.type.endsWith("/notesSlide"),
        );
      let notes = "";
      if (notesPart)
        notes = descendants(await xml(notesPart.path), "p:sp")
          .filter(
            (shape) =>
              !descendants(children(shape), "p:ph").some((ph) =>
                ["sldImg", "sldNum", "dt", "ftr", "hdr"].includes(
                  attr(ph, "type"),
                ),
              ),
          )
          .flatMap((shape) =>
            descendants(children(shape), "a:p").map((p) => text(children(p))),
          )
          .join("\n");
      result.slides.push({
        id: `slide-${result.slides.length + 1}`,
        title,
        hidden: ["0", "false"].includes(
          attr(descendants(slide, "p:sld")[0] ?? {}, "show"),
        ),
        blocks,
        notes: budget(notes),
      });
    }
    result.warnings.push(
      "Animations, transitions and embedded media do not run. Hidden slides are included and labeled; PDF page numbers may differ.",
    );
  }
  return result;
}
