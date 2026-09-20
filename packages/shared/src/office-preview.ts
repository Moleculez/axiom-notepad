/** Plain, inert content extracted from OOXML. Never HTML or executable fields. */
export type OfficeParagraph = {
  kind: "paragraph";
  id: string;
  text: string;
  heading?: number;
  list?: boolean;
};
export type OfficeTable = { kind: "table"; id: string; rows: string[][] };
export type OfficeBlock = OfficeParagraph | OfficeTable;
export type OfficeSlide = {
  id: string;
  title: string;
  hidden: boolean;
  blocks: OfficeBlock[];
  notes: string;
};
export type OfficeSnapshot = {
  format: "docx" | "pptx";
  blocks: OfficeBlock[];
  slides: OfficeSlide[];
  comments: { id: string; author: string; text: string }[];
  footnotes: { id: string; text: string }[];
  warnings: string[];
};
export function officeBlockText(block: OfficeBlock): string {
  return block.kind === "table"
    ? block.rows.map((row) => row.join("\t")).join("\n")
    : block.text;
}
export function officePlainText(snapshot: OfficeSnapshot): string {
  return snapshot.format === "docx"
    ? snapshot.blocks.map(officeBlockText).join("\n\n")
    : snapshot.slides
        .map(
          (slide, i) =>
            `Slide ${i + 1}: ${slide.title}\n${slide.blocks.map(officeBlockText).join("\n\n")}${slide.notes ? `\n\nSpeaker notes\n${slide.notes}` : ""}`,
        )
        .join("\n\n---\n\n");
}
