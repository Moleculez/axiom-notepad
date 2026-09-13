import { documentIndex } from "./document-index";
import { sectionNumberAttributes } from "./section-numbers";
import { mathRequest } from "./math-contract";
import { metadataModel } from "./metadata";
import hljs from "highlight.js/lib/common";
import julia from "highlight.js/lib/languages/julia";
import latex from "highlight.js/lib/languages/latex";
hljs.registerLanguage("julia", julia);
hljs.registerLanguage("latex", latex);
import type { MarkdownNode as N, ParsedDocument, RenderContext } from "./types";
import { plainText } from "./parser";
export const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\u0000/g, "\ufffd");
export function highlightCode(source: string, language: string) {
  return language && hljs.getLanguage(language)
    ? hljs.highlight(source, { language, ignoreIllegals: true }).value
    : escapeHtml(source);
}
function reviewText(n: N, ranges: RenderContext["reviewRanges"]) {
  const text = n.text ?? "";
  const matching = ranges?.filter((r) => r.from < n.to && r.to > n.from);
  if (!matching?.length) return escapeHtml(text);
  if (text.length !== n.to - n.from)
    return (
      '<span class="revision-word revision-' +
      matching[0].kind +
      '">' +
      escapeHtml(text) +
      "</span>"
    );
  let at = 0,
    html = "";
  for (const r of matching) {
    const from = Math.max(at, r.from - n.from),
      to = Math.min(text.length, r.to - n.from);
    html +=
      escapeHtml(text.slice(at, from)) +
      '<span class="revision-word revision-' +
      r.kind +
      '">' +
      escapeHtml(text.slice(from, to)) +
      "</span>";
    at = to;
  }
  return html + escapeHtml(text.slice(at));
}
export function safeUrl(url: string, image = false): string {
  const cleaned = url.trim().replace(/[\u0000-\u0020\u007f]/g, "");
  if (
    /^(?:javascript|vbscript|data|file):/i.test(cleaned) ||
    /^[\\/]{2}/.test(cleaned)
  )
    return "";
  if (
    /^[a-z][a-z0-9+.-]*:/i.test(cleaned) &&
    !/^(?:https?|mailto):/i.test(cleaned)
  )
    return "";
  if (image && /^mailto:/i.test(cleaned)) return "";
  return url;
}
function uri(url: string) {
  try {
    return encodeURI(url)
      .replace(/%25([0-9a-f]{2})/gi, "%$1")
      .replace(/\[/g, "%5B")
      .replace(/\]/g, "%5D")
      .replace(/\\/g, "%5C");
  } catch {
    return url;
  }
}
export function renderDocument(
  doc: ParsedDocument,
  context: RenderContext = {},
): string {
  const exact = context.conformance,
    whole = context.document ?? doc,
    index = documentIndex(whole),
    footnotes = [...index.footnotes],
    eqs = index.labels;
  const math = (text: string, display: boolean) => {
    const request = mathRequest(text, display, index);
    return (
      context.math?.(request) ??
      `<span class="math-render" data-math-request="${escapeHtml(JSON.stringify(request))}" aria-busy="true"><span class="math-pending">${escapeHtml(text)}</span></span>`
    );
  };
  const attr = (s: string) => escapeHtml(s),
    children = (n: N) => (n.children ?? []).map((c) => render(c)).join("");
  const blockAttrs = (n: N) =>
    context.blockMarks && !exact
      ? ` data-reading-from="${n.from}" data-reading-to="${n.to}" data-reading-type="${attr(n.type)}"`
      : "";
  const render = (n: N, tight = false): string => {
    let html = renderNode(n, tight);
    if (
      !exact &&
      context.reviewRanges?.some((r) => r.from < n.to && r.to > n.from) &&
      [
        "paragraph",
        "heading",
        "codeBlock",
        "mathBlock",
        "table",
        "frontmatter",
        "image",
        "hr",
      ].includes(n.type)
    )
      html = html.replace(
        /^<([a-z][\w-]*)(?=[\s>])/i,
        '<$1 data-revision="changed"',
      );
    return context.blockMarks &&
      !exact &&
      [
        "paragraph",
        "heading",
        "hr",
        "frontmatter",
        "toc",
        "codeBlock",
        "blockquote",
        "callout",
        "list",
        "image",
        "table",
        "mathBlock",
        "theorem",
        "proof",
        "htmlBlock",
      ].includes(n.type) &&
      !(tight && n.type === "paragraph")
      ? html.replace(/^<([a-z][\w-]*)(?=[\s>])/i, `<$1${blockAttrs(n)}`)
      : html;
  };
  const renderNode = (n: N, tight = false): string => {
    switch (n.type) {
      case "document":
        return children(n);
      case "text":
        return reviewText(n, exact ? undefined : context.reviewRanges);
      case "softbreak":
        return "\n";
      case "hardbreak":
        return "<br />\n";
      case "tableBreak":
        return "<br />";
      case "paragraph":
        return tight ? children(n) : `<p>${children(n)}</p>\n`;
      case "heading": {
        const decorations = exact
          ? ""
          : Object.entries(
              sectionNumberAttributes(index.sections.get(n.key ?? "")),
            )
              .map(([key, value]) => ` ${key}="${attr(value)}"`)
              .join("");
        return `<h${n.level}${exact ? "" : ` id="${attr(n.key ?? "")}"`}${decorations}>${children(n)}</h${n.level}>\n`;
      }
      case "hr":
        return "<hr />\n";
      case "em":
        return `<em>${children(n)}</em>`;
      case "strong":
        return `<strong>${children(n)}</strong>`;
      case "strike":
        return `<del>${children(n)}</del>`;
      case "highlight":
        return `<mark>${children(n)}</mark>`;
      case "subscript":
        return `<sub>${children(n)}</sub>`;
      case "superscript":
        return `<sup>${children(n)}</sup>`;
      case "underline":
        return `<u>${children(n)}</u>`;
      case "emoji":
        return `<span class="emoji" role="img" aria-label="${attr(n.key ?? "emoji")}">${attr(n.text ?? "")}</span>`;
      case "frontmatter": {
        // Metadata is passive document content, never executable YAML.
        const source = `---\n${n.text ?? ""}\n---`;
        const model = metadataModel(source, {
          type: "frontmatter",
          from: 0,
          to: source.length,
        });
        return `<section class="document-metadata"><table aria-label="Document metadata"><caption>Document metadata</caption><tbody>${(model?.properties ?? []).map((property) => `<tr><th scope="row">${attr(property.key)}</th><td>${property.complex ? `<pre>${attr(property.value)}</pre>` : attr(property.value)}</td></tr>`).join("")}</tbody></table></section>\n`;
      }
      case "toc": {
        const ancestors: number[] = [];
        return `<nav class="document-toc" aria-label="Table of contents"><div class="document-toc-title">Contents</div>${
          whole.outline.length
            ? whole.outline
                .map((heading) => {
                  while (ancestors.length && ancestors.at(-1)! >= heading.level)
                    ancestors.pop();
                  const depth = ancestors.length;
                  ancestors.push(heading.level);
                  return `<a href="#${attr(heading.id)}" style="margin-inline-start:${depth * 16}px">${attr(heading.text)}</a>`;
                })
                .join("")
            : '<span class="document-toc-empty">Add headings to build the table of contents.</span>'
        }</nav>\n`;
      }
      case "code":
        return `<code>${escapeHtml(n.text ?? "")}</code>`;
      case "html":
      case "htmlBlock":
        return exact
          ? doc.ast.kind === "gfm"
            ? (n.text ?? "").replace(
                /<(?=\/?(?:title|textarea|style|xmp|iframe|noembed|noframes|script|plaintext)(?:[\s/>]|$))/gi,
                "&lt;",
              )
            : (n.text ?? "")
          : escapeHtml(n.text ?? "");
      case "codeBlock": {
        if (!exact && n.lang === "mermaid")
          return `<div class="diagram" data-mermaid="${attr(n.text ?? "")}" data-visual-kind="mermaid" data-visual-from="${n.from}" data-visual-to="${n.to}"><pre>${escapeHtml(n.text ?? "")}</pre></div>\n`;
        const lang = n.lang ?? "";
        const highlighted =
          !exact && lang && hljs.getLanguage(lang)
            ? highlightCode(n.text ?? "", lang)
            : escapeHtml(n.text ?? "");
        return `<pre><code${lang ? ` class="language-${attr(lang)}"` : ""}>${highlighted}</code></pre>\n`;
      }
      case "blockquote":
        return `<blockquote>\n${children(n)}</blockquote>\n`;
      case "callout":
        return `<aside class="callout callout-${attr(n.kind ?? "note")}"><div class="callout-title">${attr(n.title ?? "Note")}</div>${children(n)}</aside>\n`;
      case "list": {
        const tag = n.ordered ? "ol" : "ul";
        return `<${tag}${n.ordered && n.start !== 1 ? ` start="${n.start}"` : ""}>\n${(
          n.children ?? []
        )
          .map((item) => {
            const values = item.children ?? [];
            // Keep spec-conformance HTML unchanged. Application task rows
            // share the editor's control gutter and first-baseline layout.
            if (
              !exact &&
              context.taskLayout !== "inline" &&
              item.checked !== undefined
            ) {
              const input = `<input type="checkbox" data-task-from="${item.from}" disabled=""${item.checked ? ' checked=""' : ""} aria-label="${item.checked ? "Completed task" : "Incomplete task"}" />`;
              return `<li${blockAttrs(item)} class="document-task">${input}<div class="document-task-content">${values.map((v) => render(v)).join("")}</div></li>\n`;
            }
            let body = "";
            values.forEach((v, i) => {
              let r = render(v, n.tight);
              if (i === 0 && item.checked !== undefined) {
                const input = exact
                  ? `<input${item.checked ? ' checked=""' : ""} disabled="" type="checkbox"> `
                  : `<input type="checkbox"${!exact ? ` data-task-from="${item.from}"` : ""} disabled=""${item.checked ? ' checked=""' : ""} /> `;
                r = n.tight ? input + r : r.replace("<p>", "<p>" + input);
              }
              if (i && !(values[i - 1].type !== "paragraph" || !n.tight))
                body += "\n";
              body += r;
            });
            const firstParagraph = n.tight && values[0]?.type === "paragraph";
            return `<li${blockAttrs(item)}>${!firstParagraph && values.length ? "\n" : ""}${body}${n.tight && values.at(-1)?.type === "paragraph" ? "" : ""}</li>\n`;
          })
          .join("")}</${tag}>\n`;
      }
      case "link":
        return `<a href="${attr(uri(exact ? (n.href ?? "") : safeUrl(n.href ?? "")))}"${n.title !== undefined ? ` title="${attr(n.title)}"` : ""}${!exact && /^https?:/.test(n.href ?? "") ? ' target="_blank" rel="noopener noreferrer"' : ""}>${children(n)}</a>`;
      case "image": {
        if (context.disableImages)
          return `<span class="muted">[Image disabled in scratchpad: ${escapeHtml(plainText(n))}]</span>`;
        const image = `<img src="${attr(uri(exact ? (n.href ?? "") : safeUrl(n.href ?? "", true)))}" alt="${attr(plainText(n))}"${n.title !== undefined ? ` title="${attr(n.title)}"` : ""}${exact ? "" : ' loading="lazy"'} />`;
        return context.visuals && !exact
          ? `<span class="visual-inline" data-visual-kind="image" data-visual-from="${n.from}" data-visual-to="${n.to}">${image}</span>`
          : image;
      }
      case "table": {
        const rows = n.children ?? [];
        const row = (r: N, tag: string) =>
          `<tr>\n${(r.children ?? []).map((cell, i) => `<${tag}${n.align?.[i] ? ` align="${n.align[i]}"` : ""}>${children(cell)}</${tag}>\n`).join("")}</tr>\n`;
        const html = `<table>\n<thead>\n${row(rows[0], "th")}</thead>\n${
          rows.length > 1
            ? `<tbody>\n${rows
                .slice(1)
                .map((r) => row(r, "td"))
                .join("")}</tbody>\n`
            : ""
        }</table>\n`;
        return context.scrollTables && !exact
          ? `<div class="table-scroll" role="region" aria-label="Table" tabindex="0">${html}</div>\n`
          : html;
      }
      case "mathInline":
        return `<span class="math-inline" data-math-from="${n.from}">${math(n.text ?? "", false)}</span>`;
      case "mathBlock": {
        const label = /\\label\{([^}]+)\}/.exec(n.text ?? "");
        return `<div class="math-block" data-math-from="${n.from}"${label ? ` id="eq-${attr(label[1])}"` : ""}>${math(n.text ?? "", true)}${label ? `<span class="equation-number">(${eqs.get(label[1])})</span>` : ""}</div>\n`;
      }
      case "equationRef":
        return `<a class="equation-ref" href="#eq-${attr(n.key ?? "")}">(${eqs.get(n.key ?? "") ?? "?"})</a>`;
      case "wikiLink": {
        const link = context.resolveLink?.(n.href ?? "");
        const title = link
          ? `Linked note: ${link.title}`
          : `Unresolved note: ${n.href ?? ""}`;
        return `<a class="wiki-link${link ? "" : " unresolved"}" href="${attr(link ? safeUrl(link.href) : "#")}" data-note-target="${attr(n.href ?? "")}" title="${attr(title)}">${attr(n.text ?? link?.title ?? "")}</a>`;
      }
      case "citation":
        return `<span class="citation">${n
          .key!.split(";")
          .map(
            (key) =>
              `<a href="#ref-${attr(key)}" title="${attr(context.references?.[key]?.title ?? `Unresolved citation: ${key}`)}">[${whole.citations.indexOf(key) + 1}]</a>`,
          )
          .join(", ")}</span>`;
      case "footnoteRef": {
        const key = n.key!;
        if (!footnotes.includes(key)) footnotes.push(key);
        return `<sup id="fnref-${attr(key)}"><a${exact ? "" : ` tabindex="0" data-footnote-key="${attr(key)}"`} href="#fn-${attr(key)}">${footnotes.indexOf(key) + 1}</a></sup>`;
      }
      default:
        return children(n);
    }
  };
  let output = render(doc.ast);
  if (footnotes.length && !context.fragment)
    output += `<section class="footnotes"><hr /><ol>${footnotes
      .map((key) => {
        const definition = whole.definitions?.find(
          (n) => n.type === "footnoteDefinition" && n.key === key,
        );
        return `<li id="fn-${attr(key)}"${definition ? blockAttrs(definition) : ""}>${(whole.footnotes[key] ?? []).map((n) => render(n)).join("")}<a href="#fnref-${attr(key)}" aria-label="Back to reference">↩</a></li>`;
      })
      .join("")}</ol></section>`;
  if (doc.citations.length && !exact && !context.fragment)
    output += `<section class="bibliography"><h2>References</h2><ol>${doc.citations
      .map((key) => {
        const ref = context.references?.[key];
        return `<li id="ref-${attr(key)}">${ref ? `${attr(ref.authors ?? "")}${ref.authors ? ". " : ""}<em>${attr(ref.title)}</em>${ref.year ? `, ${attr(ref.year)}` : ""}.${ref.url ? ` <a href="${attr(safeUrl(ref.url))}" target="_blank" rel="noopener noreferrer">Source ↗</a>` : ""}` : `<span class="unresolved">${attr(key)} — add this reference to the library</span>`}</li>`;
      })
      .join("")}</ol></section>`;
  return output;
}

/** Definition-only rendering keeps the owning document's numbering and math
 * context, without appending footnotes or references a second time. */
export function renderFootnoteContent(
  document: ParsedDocument,
  key: string,
  context: RenderContext = {},
): string | null {
  if (!Object.hasOwn(document.footnotes, key)) return null;
  const children = document.footnotes[key];
  return renderDocument(
    {
      ...document,
      ast: { type: "document", from: 0, to: 0, children },
    },
    {
      ...context,
      document,
      fragment: true,
      conformance: false,
      scrollTables: true,
    },
  );
}
