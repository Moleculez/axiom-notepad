import { z } from "zod";
import {
  parseMarkdown,
  documentIndex,
  macroDeclarations,
  plainText,
  type MarkdownNode,
} from "@axiom/markdown";
import {
  markdownExportSnapshotSchema,
  type MarkdownExportSnapshot,
} from "./document-export";
import { scanBibtex } from "./bibtex-model";

export const latexOptionsSchema = z.object({
  backend: z.enum(["biber", "bibtex"]).default("biber"),
  citations: z.enum(["numeric", "author-year"]).default("numeric"),
  paper: z.enum(["A4", "Letter"]).default("A4"),
  margin: z.number().int().min(8).max(40).default(20),
  title: z.boolean().default(true),
  toc: z.boolean().default(false),
  authors: z.string().max(2000).default(""),
  date: z.string().max(100).default(""),
  cjk: z.enum(["auto", "none"]).default("auto"),
});
export type LatexOptions = z.infer<typeof latexOptionsSchema>;
export const latexPreviewRequestSchema = z.object({
  snapshot: markdownExportSnapshotSchema,
  options: latexOptionsSchema,
});
export type LatexDiagnostic = {
  code: string;
  from: number;
  to: number;
  severity: "warning" | "error" | "info";
  message: string;
};
export type LatexReference = {
  cite_key: string;
  title: string;
  authors: string;
  year: string;
  url: string;
  bibtex?: string;
  doi?: string;
  arxiv?: string;
  venue?: string;
  identity: string;
  version: number;
  canonical_key?: string;
};
export type LatexAsset = {
  id: string;
  resourceId: string;
  versionId: string;
  name: string;
  mime: string;
  sha256: string;
  bytes: number;
  originalPath: string;
  figurePath?: string;
};
export type LatexProject = {
  files: Record<string, string>;
  diagnostics: LatexDiagnostic[];
  diagrams: {
    from: number;
    to: number;
    source: string;
    path: string;
    sha256?: string;
  }[];
  citationMap: Record<string, string>;
  referenceKeys: string[];
};
export type LatexPreview = LatexProject & {
  fingerprint: string;
  sourceHash: string;
  assets: LatexAsset[];
  references: LatexReference[];
  noteId: string;
  generation: number;
};
export const diagramRasterSchema = z
  .object({
    from: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f\d]{64}$/),
    png: z.string().max(28_000_000),
  })
  .strict();
export const latexSubmissionSchema = z
  .object({
    options: latexOptionsSchema,
    fingerprint: z.string().regex(/^[a-f\d]{64}$/),
    acknowledgeWarnings: z.boolean().default(false),
    diagrams: z.array(diagramRasterSchema).max(100).default([]),
  })
  .strict();

export function escapeTex(text: string) {
  const escapes: Record<string, string> = {
    "\\": "\\textbackslash{}",
    "{": "\\{",
    "}": "\\}",
    "%": "\\%",
    $: "\\$",
    "#": "\\#",
    "&": "\\&",
    _: "\\_",
    "~": "\\textasciitilde{}",
    "^": "\\textasciicircum{}",
  };
  return text
    .replace(/[\\{}%$#&_~^]/g, (ch) => escapes[ch])
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}
const label = (kind: string, key: string) =>
  `${kind}:${[...key].map((ch) => (/[a-z\d:.-]/i.test(ch) ? ch : "-" + ch.codePointAt(0)!.toString(16) + "-")).join("")}`;
const keyOK = (key: string) => /^[\w:./-]{1,100}$/.test(key);
const mathCommands = new Set(
  (
    "alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi omicron pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega " +
    "frac dfrac tfrac cfrac sqrt binom dbinom tbinom over atop choose sum prod coprod int iint iiint iiiint oint oiint bigcup bigcap bigvee bigwedge lim limsup liminf sup inf max min arg det gcd Pr " +
    "sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh coth exp log ln lg deg dim ker hom " +
    "mathbb mathbf mathcal mathscr mathfrak mathrm mathit mathsf mathtt boldsymbol bm operatorname text textrm textit textbf textsf texttt mbox " +
    "left right middle big Big bigg Bigg bigl bigr Bigl Bigr biggl biggr Biggl Biggr " +
    "hat widehat bar overline underline tilde widetilde vec dot ddot dddot acute grave breve check overset underset overbrace underbrace stackrel " +
    "le leq ge geq neq ne approx sim simeq cong equiv propto in notin ni subset subseteq supset supseteq prec succ preceq succeq ll gg lesssim gtrsim " +
    "times cdot div pm mp circ bullet ast star dagger ddagger cap cup land lor neg lnot setminus smallsetminus oplus otimes odot wedge vee " +
    "infty partial nabla ell hbar imath jmath Re Im aleph emptyset varnothing forall exists nexists top bot perp parallel angle measuredangle triangle square boxtimes " +
    "to mapsto gets rightarrow leftarrow leftrightarrow Rightarrow Leftarrow Leftrightarrow longrightarrow longleftarrow Longrightarrow Longleftarrow Longleftrightarrow hookrightarrow uparrow downarrow " +
    "langle rangle lceil rceil lfloor rfloor lbrace rbrace vert Vert mid ldots cdots vdots ddots dots dotsc dotsb dotsm " +
    "begin end label eqref ref tag notag nonumber limits nolimits displaystyle textstyle scriptstyle scriptscriptstyle quad qquad hspace vphantom hphantom phantom smash substack underbrace overbrace boxed cancel color textcolor " +
    "newcommand renewcommand providecommand DeclareMathOperator ce pu qty abs norm dv pdv derivative bra ket braket comm anticom expval eval order"
  ).split(/\s+/),
);
const mathEnvironments = new Set(
  "aligned alignedat gathered split array matrix pmatrix bmatrix Bmatrix vmatrix Vmatrix smallmatrix cases align align* alignat alignat* gather gather* equation equation* multline multline*".split(
    " ",
  ),
);
/** Conservative export subset; raw originals remain available for manual work. */
export function safeMath(tex: string, known: ReadonlySet<string> = new Set()) {
  if (
    /\^\^|\\(?:input|include|openin|openout|read|write|immediate|csname|endcsname|catcode|def|edef|gdef|xdef|let|futurelet|expandafter|usepackage|documentclass|special|scantokens|pdf\w*|shellescape)\b/.test(
      tex,
    )
  )
    return false;
  const custom = new Set<string>(known);
  for (const match of tex.matchAll(
    /\\(?:newcommand|renewcommand|providecommand|DeclareMathOperator)\*?\s*(?:\{\\([A-Za-z]+)\}|\\([A-Za-z]+))/g,
  )) {
    const name = match[1] || match[2];
    if (mathCommands.has(name)) return false;
    custom.add(name);
  }
  for (const match of tex.matchAll(/\\([A-Za-z]+)/g))
    if (!mathCommands.has(match[1]) && !custom.has(match[1])) return false;
  for (const match of tex.matchAll(/\\(?:begin|end)\s*\{([^}]+)\}/g))
    if (!mathEnvironments.has(match[1])) return false;
  return (
    !/\\(?:color|textcolor)\s*\{[^a-zA-Z]/.test(tex) && tex.length <= 100_000
  );
}

export function buildLatexProject(
  snapshot: MarkdownExportSnapshot,
  input: Partial<LatexOptions> = {},
  references: LatexReference[] = [],
  assets: LatexAsset[] = [],
): LatexProject {
  const options = latexOptionsSchema.parse(input),
    document = parseMarkdown(snapshot.source),
    index = documentIndex(document);
  const diagnostics: LatexDiagnostic[] = [
    ...document.diagnostics,
    ...index.diagnostics,
  ].map((d) => ({ ...d, code: "markdown" }));
  const warn = (
    node: Pick<MarkdownNode, "from" | "to">,
    code: string,
    message: string,
    severity: LatexDiagnostic["severity"] = "warning",
  ) =>
    diagnostics.push({ from: node.from, to: node.to, code, message, severity });
  const files: Record<string, string> = { "original.md": snapshot.source };
  // Safe declarations are document-scoped, as in the renderer, not confined to
  // the first equation group. Reject ambiguous redefinitions and recursive
  // expansion instead of generating a project that hangs its local compiler.
  const declarations = [...new Set(index.macros)],
    macroNames = new Set<string>(),
    orderedMacros: string[] = [],
    macroRecords = new Map<string, string>();
  let macrosSafe = safeMath(declarations.join("\n"));
  for (const declaration of declarations) {
    const match =
      /\\(?:newcommand|renewcommand|providecommand|DeclareMathOperator)\*?\s*(?:\{\\([A-Za-z]+)\}|\\([A-Za-z]+))/.exec(
        declaration,
      );
    const name = match?.[1] || match?.[2];
    if (!name || macroRecords.has(name)) {
      macrosSafe = false;
      continue;
    }
    macroRecords.set(name, declaration);
    macroNames.add(name);
  }
  const visiting = new Set<string>(),
    visitedMacros = new Set<string>();
  const visitMacro = (name: string): boolean => {
    if (visitedMacros.has(name)) return true;
    if (visiting.has(name)) return false;
    visiting.add(name);
    const declaration = macroRecords.get(name)!;
    for (const match of [...declaration.matchAll(/\\([A-Za-z]+)/g)].slice(2))
      if (macroNames.has(match[1]) && !visitMacro(match[1])) return false;
    visiting.delete(name);
    visitedMacros.add(name);
    orderedMacros.push(
      declaration.replace(
        /\\(?:renewcommand|providecommand)\b/,
        "\\newcommand",
      ),
    );
    return true;
  };
  if (macrosSafe)
    for (const name of macroNames) if (!visitMacro(name)) macrosSafe = false;
  if (!macrosSafe) {
    macroNames.clear();
    orderedMacros.length = 0;
    warn(
      { from: 0, to: snapshot.source.length },
      "unsupported-macros",
      "Conflicting, recursive or unsupported math macros remain in original source. Review their definitions locally.",
    );
  }
  const byKey = new Map(references.map((r) => [r.cite_key, r]));
  const selected = new Set(document.citations),
    visitDependencies = (key: string, seen = new Set<string>()) => {
      if (seen.has(key) || seen.size >= 1000) return;
      seen.add(key);
      const r = byKey.get(key);
      if (!r?.bibtex) return;
      try {
        const parsed = scanBibtex(r.bibtex),
          record =
            parsed.records.find((e) => e.key === key) ??
            parsed.records.find((e) => e.key);
        for (const name of ["crossref", "xdata"])
          for (const dependency of (record?.fields[name]?.value ?? "")
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)) {
            selected.add(dependency);
            visitDependencies(dependency, seen);
          }
      } catch {
        /* Reported below with the reference key. */
      }
    };
  document.citations.forEach((key) => visitDependencies(key));
  const citationMap: Record<string, string> = {},
    groups = new Map<string, LatexReference[]>();
  for (const key of selected) {
    const reference = byKey.get(key);
    if (reference)
      groups.set(reference.identity, [
        ...(groups.get(reference.identity) ?? []),
        reference,
      ]);
    else
      warn(
        { from: 0, to: 0 },
        "missing-citation",
        `Unresolved bibliography key: ${key}. Add it to this note's reference scope.`,
      );
  }
  const bibliography: string[] = [],
    originals: string[] = [],
    foldKeys = new Set<string>();
  for (const group of groups.values()) {
    const first = group[0],
      canonical = first.canonical_key;
    const exportKey =
      canonical &&
      keyOK(canonical) &&
      (!byKey.has(canonical) ||
        byKey.get(canonical)!.identity === first.identity)
        ? canonical
        : first.cite_key;
    group.forEach((r) => {
      citationMap[r.cite_key] = exportKey;
    });
  }
  for (const group of groups.values()) {
    const first = group[0],
      canonical = first.canonical_key;
    const exportKey =
      canonical &&
      keyOK(canonical) &&
      (!byKey.has(canonical) ||
        byKey.get(canonical)!.identity === first.identity)
        ? canonical
        : first.cite_key;
    if (!keyOK(exportKey) || foldKeys.has(exportKey.toLowerCase())) {
      warn(
        { from: 0, to: 0 },
        "invalid-citation-key",
        `Bibliography key ${exportKey} is invalid or conflicts by case.`,
        "error",
      );
      continue;
    }
    foldKeys.add(exportKey.toLowerCase());
    group.forEach((r) => {
      citationMap[r.cite_key] = exportKey;
      if (r.bibtex) originals.push(r.bibtex);
    });
    let type = "article",
      values: Record<string, string> = {
        title: first.title,
        author: first.authors,
        year: first.year,
        url: first.url,
        doi: first.doi ?? "",
        eprint: first.arxiv ?? "",
        journal: first.venue ?? "",
      };
    if (first.bibtex)
      try {
        const parsed = scanBibtex(first.bibtex),
          record =
            parsed.records.find((r) => r.key === first.cite_key) ??
            parsed.records.find((r) => r.key);
        parsed.warnings.forEach((message) =>
          warn(
            { from: 0, to: 0 },
            "bibliography-data",
            `${first.cite_key}: ${message}`,
          ),
        );
        if (record) {
          type = record.type;
          values = Object.fromEntries(
            Object.entries(record.fields).map(([name, v]) => [name, v.value]),
          );
        }
      } catch (error) {
        warn(
          { from: 0, to: 0 },
          "bibliography-data",
          `${first.cite_key}: ${error instanceof Error ? error.message : "Invalid BibTeX"}. Export uses the reviewed metadata; original is retained.`,
        );
      }
    for (const name of ["crossref", "xdata"])
      if (values[name])
        values[name] = values[name]
          .split(",")
          .map((key) => citationMap[key.trim()] ?? key.trim())
          .join(",");
    // Resolve strings into values and leave all originals untouched. No @preamble
    // or remote data sources become active in the generated bibliography.
    const fields = Object.entries(values)
      .filter(([name, v]) => v && !["file", "ids"].includes(name))
      .map(([name, v]) => {
        if (/\\/.test(v) && !safeMath(v)) {
          warn(
            { from: 0, to: 0 },
            "unsafe-bibliography",
            `${first.cite_key}.${name}: unsupported TeX was made literal.`,
          );
          v = escapeTex(v);
        } else
          v = v
            .split(/(\$(?:[^$]|\\\$)*\$)/g)
            .map((part, i) =>
              i % 2 ? part : part.replace(/(?<!\\)[%&#_]/g, (ch) => "\\" + ch),
            )
            .join("");
        return `  ${name} = {${v}}`;
      });
    const aliases = group
      .map((r) => r.cite_key)
      .filter((key) => key !== exportKey);
    if (options.backend === "biber" && aliases.length)
      fields.push(`  ids = {${aliases.join(",")}}`);
    bibliography.push(`@${type}{${exportKey},\n${fields.join(",\n")}\n}`);
  }
  files["references.bib"] = bibliography.join("\n\n") + "\n";
  files["references-original.bib"] =
    [...new Set(originals)].join("\n\n") + "\n";
  const diagrams: LatexProject["diagrams"] = [],
    footnotes = new Map<string, number>(),
    deferredFootnotes: string[] = [];
  const assetMap = new Map(assets.map((a) => [a.id, a])),
    labels = new Set<string>();
  let physics = /\\(?:qty|dv|pdv|bra|ket|braket|expval)\b/.test(
      orderedMacros.join("\n"),
    ),
    chemistry = /\\(?:ce|pu)\b/.test(orderedMacros.join("\n")),
    tableDepth = 0,
    footnoteDepth = 0;
  const rawFallback = (n: MarkdownNode, reason: string) => {
    warn(n, "unsupported-block", reason);
    const path = `code/block-${n.from}.txt`;
    files[path] = n.text ?? snapshot.source.slice(n.from, n.to);
    return footnoteDepth
      ? `\\texttt{${escapeTex(files[path])}}`
      : `\\VerbatimInput[breaklines=true,fontsize=\\small]{${path}}\n`;
  };
  const children = (n: MarkdownNode) => (n.children ?? []).map(render).join("");
  const math = (n: MarkdownNode) => {
    let tex = n.text ?? "";
    if (macrosSafe)
      for (const declaration of macroDeclarations(tex).reverse())
        tex = tex.slice(0, declaration.from) + tex.slice(declaration.to);
    if (/\\require\s*\{physics\}/.test(tex)) {
      physics = true;
      tex = tex.replace(/\\require\s*\{physics\}/g, "");
    }
    if (
      !safeMath(tex, macroNames) ||
      (!macrosSafe && macroDeclarations(tex).length)
    )
      return rawFallback(
        n,
        "Unsupported or unsafe TeX is preserved as literal source. Review it locally before compiling.",
      );
    if (!tex.trim()) return "";
    chemistry ||= /\\(?:ce|pu)\b/.test(tex);
    physics ||= /\\(?:qty|dv|pdv|bra|ket|braket|expval)\b/.test(tex);
    tex = tex.replace(
      /\\(label|eqref|ref)\s*\{([^}]+)\}/g,
      (_, command: string, key: string) => {
        if (command === "label") {
          if (labels.has(key)) return "";
          labels.add(key);
        }
        return `\\${command}{${label("eq", key)}}`;
      },
    );
    if (n.type === "mathInline") return `\\(${tex}\\)`;
    if (
      /^\s*\\begin\{(?:align\*?|gather\*?|equation\*?|multline\*?|alignat\*?)\}/.test(
        tex,
      )
    )
      return "\n" + tex + "\n\n";
    const environment = /\\label\{/.test(tex) ? "equation" : "equation*";
    return `\n\\begin{${environment}}\n${tex}\n\\end{${environment}}\n\n`;
  };
  const render = (n: MarkdownNode): string => {
    switch (n.type) {
      case "document":
        return children(n);
      case "text":
      case "emoji":
        return escapeTex(n.text ?? "");
      case "softbreak":
        return "\n";
      case "hardbreak":
      case "tableBreak":
        return "\\newline{}\n";
      case "paragraph":
        return children(n) + "\n\n";
      case "heading": {
        const command = [
          "section",
          "subsection",
          "subsubsection",
          "paragraph",
          "subparagraph",
          "subparagraph",
        ][Math.max(0, Math.min(5, (n.level ?? 1) - 1))];
        return `\\${command}{${children(n)}}\\label{${label("sec", n.key ?? String(n.from))}}\n\n`;
      }
      case "em":
        return `\\emph{${children(n)}}`;
      case "strong":
        return `\\textbf{${children(n)}}`;
      case "underline":
        return `\\uline{${children(n)}}`;
      case "strike":
        return `\\sout{${children(n)}}`;
      case "highlight":
        return `\\textbf{${children(n)}}`;
      case "subscript":
        return `\\textsubscript{${children(n)}}`;
      case "superscript":
        return `\\textsuperscript{${children(n)}}`;
      case "code":
        return `\\texttt{${escapeTex(n.text ?? "")}}`;
      case "hr":
        return "\\par\\medskip\\noindent\\rule{\\linewidth}{0.5pt}\\par\\medskip\n";
      case "toc":
        return "\\tableofcontents\n\\medskip\n";
      case "frontmatter":
        warn(
          n,
          "metadata-source",
          "Document metadata is retained in original.md. Paper authors and date use the explicit export fields.",
          "info",
        );
        return ""; // Original metadata stays in original.md; no executable YAML/preamble.
      case "html":
      case "htmlBlock":
        return rawFallback(
          n,
          "Raw HTML is exported as literal source, not executable content.",
        );
      case "mathBlock":
      case "mathInline":
        return math(n);
      case "equationRef":
        return `\\eqref{${label("eq", n.key ?? "")}}`;
      case "blockquote":
        return `\\begin{quote}\n${children(n)}\\end{quote}\n\n`;
      case "callout":
        return `\\begin{quote}\n\\textbf{${escapeTex(n.title ?? n.kind ?? "Note")}}\\par\n${children(n)}\\end{quote}\n\n`;
      case "list": {
        const environment = n.ordered ? "enumerate" : "itemize";
        return `\\begin{${environment}}${n.ordered && (n.start ?? 1) !== 1 ? `[start=${n.start}]` : ""}\n${(n.children ?? []).map((item) => `\\item${item.checked !== undefined ? `[\\(${item.checked ? "\\boxtimes" : "\\square"}\\)]` : ""} ${children(item)}\n`).join("")}\\end{${environment}}\n\n`;
      }
      case "table": {
        const rows = n.children ?? [],
          count = rows[0]?.children?.length ?? 0;
        if (!count || count > 30)
          return rawFallback(
            n,
            "Table has unsupported column dimensions; original is retained.",
          );
        tableDepth++;
        const body = rows
          .map(
            (row, i) =>
              (row.children ?? [])
                .map((cell) =>
                  i === 0
                    ? `\\textbf{${children(cell).trim()}}`
                    : children(cell).trim(),
                )
                .join(" & ") +
              " \\\\" +
              (i === 0 ? "\\midrule" : ""),
          )
          .join("\n");
        tableDepth--;
        const spec = Array.from(
          { length: count },
          (_, i) =>
            `>{\\${n.align?.[i] === "right" ? "raggedleft" : n.align?.[i] === "center" ? "centering" : "raggedright"}\\arraybackslash}X`,
        ).join("");
        const deferred = deferredFootnotes.splice(0).join("\n");
        return `\\par\\medskip\\noindent\n\\begin{tabularx}{\\linewidth}{${spec}}\n\\toprule\n${body}\n\\bottomrule\n\\end{tabularx}\n${deferred}\n\\par\\medskip\n`;
      }
      case "codeBlock": {
        const path = `code/block-${n.from}.txt`;
        files[path] = n.text ?? "";
        if (footnoteDepth)
          return rawFallback(
            n,
            "Verbatim code in a footnote uses a literal text fallback.",
          );
        if (n.lang === "mermaid") {
          const figure = `figures/diagram-${n.from}.png`;
          diagrams.push({
            from: n.from,
            to: n.to,
            source: n.text ?? "",
            path: figure,
          });
          return `\\par\\medskip\\noindent\\IfFileExists{${figure}}{\\includegraphics[width=\\linewidth,keepaspectratio]{${figure}}}{\\textit{Diagram unavailable; original source: ${escapeTex(path)}}}\\par\\medskip\n`;
        }
        return `\n\\Needspace{4\\baselineskip}\n${n.lang ? `\\noindent\\textit{${escapeTex(n.lang)}}\\par\n` : ""}\\VerbatimInput[breaklines=true,fontsize=\\small]{${path}}\n\n`;
      }
      case "image":
      case "link": {
        const href = n.href ?? "",
          id = /^\/api\/v1\/attachments\/([a-f\d-]{36})(?:[?#]|$)/i
            .exec(href)?.[1]
            ?.toLowerCase(),
          asset = id ? assetMap.get(id) : undefined;
        if (n.type === "image") {
          if (asset?.figurePath)
            return `\\includegraphics[width=\\linewidth,height=.8\\textheight,keepaspectratio]{${asset.figurePath}}`;
          warn(
            n,
            "image-unavailable",
            "Image cannot be embedded. Its source link and any available original are retained; external images are never fetched.",
          );
          return `\\textit{[Image: ${escapeTex(plainText(n))}]}${asset ? `\\href{${asset.originalPath}}{original file}` : ""}`;
        }
        if (asset) return `\\href{${asset.originalPath}}{${children(n)}}`;
        if (id) {
          warn(
            n,
            "attachment-unavailable",
            "Attachment is unavailable in the current access scope.",
            "error",
          );
          return children(n);
        }
        if (href.startsWith("#"))
          return `\\hyperref[${label(href.startsWith("#eq-") ? "eq" : "sec", href.replace(/^#(?:eq-)?/, ""))}]{${children(n)}}`;
        if (!/^(https?:|mailto:)/i.test(href)) {
          warn(
            n,
            "link-target",
            "A non-portable or unsafe link is displayed as text; source is retained.",
          );
          return children(n);
        }
        return `\\href{${escapeTex(href)}}{${children(n)}}`;
      }
      case "wikiLink":
        warn(
          n,
          "note-link",
          "Linked notes are not included in this single-note project; link text is retained.",
        );
        return escapeTex(n.text || n.href || "Linked note");
      case "citation": {
        return (n.key ?? "")
          .split(";")
          .map((key) => {
            const mapped = citationMap[key];
            if (!mapped) {
              warn(n, "missing-citation", `Unresolved citation: ${key}.`);
              return `\\textbf{[Unresolved: ${escapeTex(key)}]}`;
            }
            const citationKey = options.backend === "biber" ? key : mapped;
            return `\\${options.backend === "biber" ? "autocite" : "citep"}{${citationKey}}`;
          })
          .join(", ");
      }
      case "footnoteRef": {
        const key = n.key ?? "";
        if (footnotes.has(key)) return `\\footnotemark[${footnotes.get(key)}]`;
        if (footnoteDepth) {
          warn(
            n,
            "nested-footnote",
            "Nested/cyclic footnotes are displayed literally.",
          );
          return escapeTex(`[^${key}]`);
        }
        const number = footnotes.size + 1;
        footnotes.set(key, number);
        if (!document.footnotes[key])
          warn(n, "missing-footnote", `Missing footnote: ${key}.`);
        footnoteDepth++;
        const content =
          (document.footnotes[key] ?? []).map(render).join("").trim() ||
          escapeTex(`Missing footnote: ${key}`);
        footnoteDepth--;
        if (tableDepth) {
          deferredFootnotes.push(`\\footnotetext[${number}]{${content}}`);
          return `\\footnotemark[${number}]`;
        }
        return `\\footnote[${number}]{${content}}`;
      }
      case "media":
        return `\\par\\medskip${children(n)}\\par\\medskip\n`;
      default:
        return n.children
          ? children(n)
          : rawFallback(
              n,
              `Unsupported Markdown block: ${n.type}. Original is retained.`,
            );
    }
  };
  const body = render(document.ast);
  const hasCJK =
    options.cjk === "auto" &&
    /[\u3400-\u9fff]/.test(snapshot.source + bibliography.join(""));
  const bibliographyConfig =
    orderedMacros.join("\n") +
    "\n\\usepackage{needspace}\n" +
    (options.backend === "biber"
      ? `\\usepackage[backend=biber,style=${options.citations === "numeric" ? "numeric" : "authoryear"},sorting=${options.citations === "numeric" ? "none" : "nyt"}]{biblatex}\n\\addbibresource{references.bib}`
      : `\\usepackage[${options.citations === "numeric" ? "numbers" : "authoryear"}]{natbib}\n\\bibliographystyle{${options.citations === "numeric" ? "unsrtnat" : "plainnat"}}`);
  files["main.tex"] =
    `% Generated from a frozen Axiom Markdown snapshot. Edit locally; originals are untouched.\n\\documentclass[11pt,${options.paper === "A4" ? "a4paper" : "letterpaper"}]{article}\n\\usepackage[margin=${options.margin}mm]{geometry}\n\\usepackage{fontspec}\n\\setmainfont[BoldFont=lmroman10-bold.otf,ItalicFont=lmroman10-italic.otf,BoldItalicFont=lmroman10-bolditalic.otf]{lmroman10-regular.otf}\n\\setmonofont{lmmono10-regular.otf}\n${hasCJK ? "\\usepackage{xeCJK}\n\\setCJKmainfont[BoldFont=FandolSong-Bold.otf]{FandolSong-Regular.otf}\n" : ""}\\usepackage{amsmath,amssymb,graphicx,booktabs,tabularx,enumitem,fvextra,xcolor}\n\\usepackage[normalem]{ulem}\n${physics ? "\\usepackage{physics}\n" : ""}${chemistry ? "\\usepackage[version=4]{mhchem}\n" : ""}${bibliographyConfig}\n\\usepackage[hidelinks,unicode]{hyperref}\n\\setlength{\\emergencystretch}{3em}\n\\setlength{\\parskip}{.45em}\n\\setlistdepth{10}\n\\renewlist{itemize}{itemize}{10}\n\\renewlist{enumerate}{enumerate}{10}\n\\setlist[itemize]{label=\\textbullet,leftmargin=*}\n\\setlist[enumerate]{label=\\arabic*.,leftmargin=*}\n\\title{${escapeTex(snapshot.title)}}\n\\author{${escapeTex(options.authors)}}\n\\date{${escapeTex(options.date)}}\n\\begin{document}\n${options.title ? "\\maketitle\n" : ""}${options.toc && !document.ast.children?.some((n) => n.type === "toc") ? "\\tableofcontents\n\\medskip\n" : ""}${body}\n${bibliography.length ? (options.backend === "biber" ? "\\printbibliography\n" : "\\bibliography{references}\n") : ""}\\end{document}\n`;
  const tool = options.backend === "biber" ? "biber main" : "bibtex main";
  files["COMPILE.md"] =
    `# Editable research project\n\nThis project uses XeLaTeX and ${options.backend === "biber" ? "BibLaTeX/Biber" : "natbib/BibTeX"}. Install a current TeX Live or MiKTeX distribution with the packages named in main.tex.\n\nFrom this directory:\n\n\`\`\`sh\nxelatex -no-shell-escape -halt-on-error main.tex\n${bibliography.length ? tool + "\n" : ""}xelatex -no-shell-escape -halt-on-error main.tex\nxelatex -no-shell-escape -halt-on-error main.tex\n\`\`\`\n\nNo compiler or hosted service ran during export. The reading preview is not a compiled PDF. No-shell-escape is not a sandbox: review untrusted TeX and compile in an isolated environment. Original Markdown and bibliography records are evidence, not automatically executable input. Unsupported content and unresolved references are recorded in export-manifest.json; never mistake placeholders for complete results. Original attachments may contain EXIF or other private metadata. Comments, private annotations, bookmarks and account details are excluded. Linked notes and external images were not downloaded.\n`;
  return {
    files,
    diagnostics,
    diagrams,
    citationMap,
    referenceKeys: [...selected],
  };
}
