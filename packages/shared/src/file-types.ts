/** One creation contract shared by Explorer, offline commands and MCP. */
export const fileTypes = [
  {
    id: "markdown",
    label: "Markdown note",
    extension: "md",
    group: "Research",
    icon: "newNote",
    description: "Rich Markdown with equations, citations, and collaboration.",
  },
  {
    id: "canvas",
    label: "Canvas",
    extension: "canvas",
    group: "Research",
    icon: "canvas",
    description: "A collaborative space for connected ideas and files.",
  },
  {
    id: "math",
    label: "Math project",
    extension: "tex",
    group: "Research",
    icon: "math",
    description: "Live LaTeX and visual equation input.",
  },
  {
    id: "image",
    label: "Drawing / image project",
    extension: "axiom-image",
    group: "Research",
    icon: "image",
    description: "A layered figure in Image Studio.",
  },
  {
    id: "text",
    label: "Plain text",
    extension: "txt",
    group: "Text & data",
    icon: "source",
    description: "Collaborative text without Markdown parsing.",
  },
  {
    id: "csv",
    label: "CSV data",
    extension: "csv",
    group: "Text & data",
    icon: "table",
    description: "Comma-separated data in the text editor.",
  },
  {
    id: "json",
    label: "JSON file",
    extension: "json",
    group: "Text & data",
    icon: "source",
    description: "Structured JSON with source highlighting.",
  },
  {
    id: "yaml",
    label: "YAML file",
    extension: "yaml",
    group: "Text & data",
    icon: "source",
    description: "Human-readable structured data.",
  },
  {
    id: "docx",
    label: "Word document",
    extension: "docx",
    group: "Office",
    icon: "file",
    description:
      "Create and preview a document. Edit in your desktop Office app.",
  },
  {
    id: "xlsx",
    label: "Excel workbook",
    extension: "xlsx",
    group: "Office",
    icon: "table",
    description:
      "Create and preview a workbook. Edit in your desktop Office app.",
  },
  {
    id: "pptx",
    label: "PowerPoint slides",
    extension: "pptx",
    group: "Office",
    icon: "file",
    description: "Create and preview slides. Edit in your desktop Office app.",
  },
] as const;
export type FileType = (typeof fileTypes)[number]["id"];
export const fileTypeIds = fileTypes.map((t) => t.id) as [
  FileType,
  ...FileType[],
];
export const sourceForNewFile = (type: FileType) =>
  type === "json"
    ? "{}\n"
    : type === "csv"
      ? "Column A,Column B\n"
      : type === "yaml"
        ? "# Research data\n"
        : type === "canvas"
          ? '{"nodes":[],"edges":[]}'
          : "";
