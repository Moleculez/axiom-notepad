/** Stable product-guide routes; content and playground engines load on demand. */
export const docSections = [
  ["start", "Start here"],
  ["editor", "Markdown editor"],
  ["research", "Reading & evidence"],
  ["canvas", "Canvas"],
  ["tools", "Studios & viewers"],
  ["workspace", "Working together"],
  ["preferences", "Make it yours"],
] as const;
export type DocSection = (typeof docSections)[number][0];
export type DocArticle = {
  id: string;
  section: DocSection;
  title: string;
  summary: string;
  keywords: string;
  playground?: "editor" | "canvas";
};
export const docArticles: readonly DocArticle[] = [
  {
    id: "start/overview",
    section: "start",
    title: "Your first research workspace",
    summary: "Find your way from a source to a shared result.",
    keywords: "onboarding home toolbar files navigation",
  },
  {
    id: "editor/basics",
    section: "editor",
    title: "Write, Source & Read",
    summary: "One Markdown document, three ways to work.",
    keywords: "wysiwyg markdown source slash undo formatting",
    playground: "editor",
  },
  {
    id: "editor/structure",
    section: "editor",
    title: "Headings, lists & quotations",
    summary: "Build structure without fighting the cursor.",
    keywords:
      "heading section numbered bullet task checkbox nested quote callout divider",
    playground: "editor",
  },
  {
    id: "editor/tables",
    section: "editor",
    title: "Tables",
    summary: "Edit cells and grow rows and columns at the edges.",
    keywords: "table tsv column row alignment context menu",
    playground: "editor",
  },
  {
    id: "editor/code",
    section: "editor",
    title: "Code blocks",
    summary: "Language selection, highlighting, wrapping and copying.",
    keywords: "fence language autocomplete syntax code line numbers",
    playground: "editor",
  },
  {
    id: "editor/math",
    section: "editor",
    title: "Mathematics & research callouts",
    summary: "TeX equations, chemistry, labels and assumptions.",
    keywords:
      "latex tex math chemistry equation theorem proof lemma definition",
    playground: "editor",
  },
  {
    id: "editor/definitions",
    section: "editor",
    title: "Footnotes, metadata & link definitions",
    summary: "Keep document properties and supporting explanations tidy.",
    keywords: "frontmatter yaml footnote reference link definition properties",
    playground: "editor",
  },
  {
    id: "editor/media",
    section: "editor",
    title: "Images, attachments & figures",
    summary: "Insert evidence with stable source and version links.",
    keywords:
      "image file upload paste drop slash caption figure reference code pdf audio video",
  },
  {
    id: "editor/connections",
    section: "editor",
    title: "Note links, citations & Mermaid",
    summary: "Connect ideas, cite papers and draw diagrams.",
    keywords: "wiki backlink citation bibliography mermaid diagram graph",
    playground: "editor",
  },
  {
    id: "editor/navigation",
    section: "editor",
    title: "Outline, minimap & reading marks",
    summary: "Navigate long documents and remember important passages.",
    keywords:
      "toc outline minimap bookmark annotation search folding block range",
  },
  {
    id: "editor/snippets",
    section: "editor",
    title: "Templates & reusable snippets",
    summary: "Start from a method and keep an independent copy.",
    keywords: "template snippet reusable insert archive",
  },
  {
    id: "editor/review",
    section: "editor",
    title: "Collaboration, history & suggestions",
    summary: "Understand what changed before applying a revision.",
    keywords:
      "collaboration sync version diff suggestion review discussion comment restore autosave",
  },
  {
    id: "editor/export",
    section: "editor",
    title: "Read mode & export",
    summary: "Share styled snapshots without exposing your workspace.",
    keywords: "read only readonly print pdf html export markdown zip",
  },
  {
    id: "editor/shortcuts",
    section: "editor",
    title: "Commands & keyboard shortcuts",
    summary: "The live command catalogue, including your custom bindings.",
    keywords: "command keyboard shortcut slash keybinding hotkey",
  },
  {
    id: "research/workbench",
    section: "research",
    title: "The evidence workbench",
    summary: "Resume reading, organize evidence and create a synthesis.",
    keywords: "research queue annotations bookmarks synthesis note canvas",
  },
  {
    id: "research/references",
    section: "research",
    title: "Reference library",
    summary:
      "Manage personal/group libraries, collections and citation-safe merges.",
    keywords:
      "reference bibliography bibtex ris doi arxiv cite reading status library collections duplicates merge trash graph",
  },
  {
    id: "research/pdf",
    section: "research",
    title: "Read and annotate PDFs",
    summary:
      "Find passages, inspect versions and follow evidence back to its page.",
    keywords:
      "pdf highlight drawing annotation comparison ocr bookmark selection",
  },
  {
    id: "canvas/basics",
    section: "canvas",
    title: "Think on a Canvas",
    summary: "Arrange editable cards and connect your ideas.",
    keywords: "canvas card connection group pan zoom selection resize",
    playground: "canvas",
  },
  {
    id: "canvas/evidence",
    section: "canvas",
    title: "File cards, layout & export",
    summary: "Keep evidence beside your thinking, with portable exports.",
    keywords:
      "canvas file preview nested webpage image math pdf export json svg",
  },
  {
    id: "tools/math",
    section: "tools",
    title: "Math Studio",
    summary: "Work on a dedicated equation file and export its rendering.",
    keywords:
      "math studio latex autocomplete svg png jpg source symbols templates",
  },
  {
    id: "tools/image",
    section: "tools",
    title: "Image Studio & visual viewer",
    summary: "Crop, resize and edit images; inspect images and diagrams.",
    keywords: "image studio crop resize layers exif zoom mermaid viewer",
  },
  {
    id: "tools/viewers",
    section: "tools",
    title: "Text, media & Office files",
    summary: "Open files in the right view without a separate tools area.",
    keywords:
      "text csv txt json audio video mp3 mp4 word excel powerpoint office",
  },
  {
    id: "workspace/files",
    section: "workspace",
    title: "Explorer, file identity & Trash",
    summary: "Import notes and folders, organize files and recover deleted work.",
    keywords:
      "explorer directory move drag copy trash audit storage versions folder import markdown zip resume",
  },
  {
    id: "workspace/groups",
    section: "workspace",
    title: "Groups, workspaces & sharing",
    summary: "Understand where work lives and who can access it.",
    keywords: "account group invitation workspace role permission sharing",
  },
  {
    id: "workspace/planning",
    section: "workspace",
    title: "Planning & Gantt",
    summary: "Connect tasks, milestones, dependencies and capacity.",
    keywords:
      "task board calendar gantt workload portfolio baseline capacity goals intake requests decision archive",
  },
  {
    id: "workspace/websites",
    section: "workspace",
    title: "Publish a research website",
    summary: "Review a frozen release before making it public.",
    keywords: "site website blog publication domain analytics theme archive",
  },
  {
    id: "workspace/assistant",
    section: "workspace",
    title: "The research assistant",
    summary: "Choose evidence, review outgoing context and approve changes.",
    keywords: "ai llm assistant provider evidence review change set privacy",
  },
  {
    id: "workspace/offline",
    section: "workspace",
    title: "Offline work & synchronization",
    summary: "Know what is saved, what is pending and how to recover.",
    keywords: "pwa offline sync recovery save backup encryption",
  },
  {
    id: "workspace/mcp",
    section: "workspace",
    title: "MCP & integrations",
    summary: "Connect tools with explicit, revocable permissions.",
    keywords: "mcp oauth integration automation scope llm",
  },
  {
    id: "preferences/appearance",
    section: "preferences",
    title: "Appearance & editor preferences",
    summary: "Tune typography, themes, guides and editing behavior.",
    keywords:
      "settings appearance theme font color typography material fluent size minimap",
  },
  {
    id: "extensions",
    section: "workspace",
    title: "Workspace extensions",
    summary:
      "Run native research helpers with explicit permissions and reviewed changes.",
    keywords:
      "extension plugin sdk sandbox journal document health planning brief grant safe mode rollback activity",
  },
] as const;
export function docArticle(id: string) {
  return docArticles.find((article) => article.id === id);
}
export function docRoute(id = "") {
  return "/docs" + (id ? "/" + id : "");
}
export function searchDocumentation(query: string) {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return docArticles.filter((a) =>
    words.every((word) =>
      `${a.title} ${a.summary} ${a.keywords}`
        .toLocaleLowerCase()
        .includes(word),
    ),
  );
}
