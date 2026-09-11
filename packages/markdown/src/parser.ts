import { decodeHTMLStrict } from "entities";
import type { Dialect, MarkdownNode as N, ParsedDocument } from "./types";

type Line = {
  text: string;
  from: number;
  to: number;
  column?: number;
  lazy?: boolean;
};
type Ref = { href: string; title?: string };
type Context = {
  dialect: Dialect;
  refs: Map<string, Ref>;
  footnotes: Record<string, N[]>;
  definitions: N[];
  depth: number;
  budget: { remaining: number; limited: boolean };
};
const blank = (s: string) => /^[ \t]*$/.test(s);
const punctuation = (s: string) => /[\p{P}\p{S}]/u.test(s);
const whitespace = (s: string) => !s || /\s/u.test(s);
const normalize = (s: string) =>
  s
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/ς/g, "σ");
const unescape = (s: string) =>
  s.replace(
    /\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])|&(?:#[xX][a-fA-F0-9]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g,
    (m, p) => p ?? decodeHTMLStrict(m),
  );
const node = (
  type: string,
  from: number,
  to: number,
  props: Partial<N> = {},
): N => ({ type, from, to, ...props });
const indent = (s: string) => {
  let n = 0;
  for (const c of s) {
    if (c === " ") n++;
    else if (c === "\t") n += 4 - (n % 4);
    else break;
  }
  return n;
};
function strip(l: Line, columns: number): Line {
  let pos = 0,
    col = l.column ?? 0;
  const target = col + columns;
  while (pos < l.text.length && col < target && /[ \t]/.test(l.text[pos])) {
    col += l.text[pos] === "\t" ? 4 - (col % 4) : 1;
    pos++;
  }
  return {
    ...l,
    text: " ".repeat(Math.max(0, col - target)) + l.text.slice(pos),
    from: l.from + pos - Math.max(0, col - target),
    column: target,
  };
}
function linesOf(source: string): Line[] {
  const result: Line[] = [];
  const re = /([^\r\n]*)(\r\n|\r|\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) && m[0])
    result.push({ text: m[1], from: m.index, to: m.index + m[0].length });
  return result;
}
function combine(
  lines: Line[],
  trim = true,
): { text: string; positions: number[] } {
  let text = "";
  const positions: number[] = [];
  lines.forEach((l, index) => {
    let value = l.text,
      offset = 0;
    if (trim) {
      offset = value.match(/^[ \t]*/)?.[0].length ?? 0;
      value = value.slice(offset);
      if (index === lines.length - 1) value = value.trimEnd();
    }
    for (let i = 0; i < value.length; i++) {
      text += value[i];
      positions.push(l.from + offset + i);
    }
    if (index < lines.length - 1) {
      text += "\n";
      positions.push(l.to - 1);
    }
  });
  positions.push(lines.at(-1)?.to ?? 0);
  return { text, positions };
}
const hr = (s: string) =>
  /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(s);
const fence = (s: string) => {
  const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(s);
  return m && !(m[1][0] === "`" && m[2].includes("`")) ? m : null;
};
const atx = (s: string) => /^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$/.exec(s);
function listMarker(s: string) {
  const m = /^( {0,3})([-+*]|\d{1,9}[.)])([ \t]+|$)(.*)$/.exec(s);
  if (!m || hr(s)) return null;
  const markerEnd = m[1].length + m[2].length;
  let col = markerEnd;
  for (const c of m[3]) col += c === "\t" ? 4 - (col % 4) : 1;
  const pad = col - markerEnd;
  const width = markerEnd + (!m[4] || pad > 4 ? 1 : pad || 1);
  return {
    indent: m[1].length,
    width,
    marker: m[2].at(-1)!,
    ordered: m[2].length > 1,
    start: m[2].length > 1 ? parseInt(m[2]) : 1,
    empty: !m[4],
  };
}
const blockTags =
  "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|search|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
const tagSource =
  "(?:<[A-Za-z][A-Za-z0-9-]*(?:[ \\t\\n]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \\t\\n]*=[ \\t\\n]*(?:[^ \\t\\n\"'`=<>]+|'[^']*'|\"[^\"]*\"))?)*[ \\t\\n]*/?>|</[A-Za-z][A-Za-z0-9-]*[ \\t\\n]*>)";
const tagRE = new RegExp("^" + tagSource);
function stripMarker(l: Line, width: number): Line {
  const m = /^( {0,3})([-+*]|\d{1,9}[.)])/.exec(l.text)!;
  let pos = m[0].length,
    col = pos;
  while (pos < l.text.length && col < width && /[ \t]/.test(l.text[pos])) {
    col += l.text[pos] === "\t" ? 4 - (col % 4) : 1;
    pos++;
  }
  const extra = Math.max(0, col - width);
  return {
    ...l,
    text: " ".repeat(extra) + l.text.slice(pos),
    from: l.from + pos - extra,
    column: width,
  };
}
function htmlBlock(s: string): { end?: RegExp; interrupt: boolean } | null {
  if (indent(s) > 3) return null;
  const t = s.trimStart();
  if (/^<(script|pre|style|textarea)(?:\s|>|$)/i.test(t))
    return { end: /<\/(?:script|pre|style|textarea)>/i, interrupt: true };
  if (t.startsWith("<!--")) return { end: /-->/, interrupt: true };
  if (t.startsWith("<?")) return { end: /\?>/, interrupt: true };
  if (t.startsWith("<![CDATA[")) return { end: /\]\]>/, interrupt: true };
  if (/^<![A-Z]/.test(t)) return { end: />/, interrupt: true };
  if (new RegExp("^</?(?:" + blockTags + ")(?:[ \\t/>]|$)", "i").test(t))
    return { interrupt: true };
  if (new RegExp("^" + tagSource + "[ \\t]*$").test(t))
    return { interrupt: false };
  return null;
}
function interrupts(s: string, paragraph = true) {
  const marker = listMarker(s);
  return !!(
    atx(s) ||
    hr(s) ||
    fence(s) ||
    /^ {0,3}>/.test(s) ||
    htmlBlock(s)?.interrupt ||
    (marker &&
      (!paragraph ||
        (!marker.empty && (!marker.ordered || marker.start === 1))))
  );
}
function destination(
  s: string,
  pos: number,
): { href: string; end: number } | null {
  const start = pos;
  if (s[pos] === "<") {
    pos++;
    while (pos < s.length) {
      if (s[pos] === "\\" && /[\\<>]/.test(s[pos + 1] ?? "")) {
        pos += 2;
        continue;
      }
      if (s[pos] === ">")
        return { href: unescape(s.slice(start + 1, pos)), end: pos + 1 };
      if (s[pos] === "\n" || s[pos] === "<") return null;
      pos++;
    }
    return null;
  }
  let depth = 0;
  while (pos < s.length) {
    const c = s[pos];
    if (
      c === "\\" &&
      /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.test(s[pos + 1] ?? "")
    ) {
      pos += 2;
      continue;
    }
    if (/[ \t\n\r\u0000-\u001f]/.test(c)) break;
    if (c === "(") {
      if (++depth > 32) return null;
    }
    if (c === ")") {
      if (!depth) break;
      depth--;
    }
    pos++;
  }
  return depth ? null : { href: unescape(s.slice(start, pos)), end: pos };
}
function readTitle(
  s: string,
  pos: number,
): { title: string; end: number } | null {
  const open = s[pos],
    close = open === "(" ? ")" : open;
  if (!['"', "'", "("].includes(open)) return null;
  let j = pos + 1;
  for (; j < s.length; j++) {
    if (s[j] === "\\" && s[j + 1]) {
      j++;
      continue;
    }
    if (s[j] === close)
      return { title: unescape(s.slice(pos + 1, j)), end: j + 1 };
    if (open === "(" && s[j] === "(") return null;
    if (s[j] === "\n" && /^\s*\n/.test(s.slice(j + 1))) return null;
  }
  return null;
}
function definition(lines: Line[], index: number, ctx: Context): number {
  const s = lines
    .slice(index, index + 8)
    .map((l) => l.text)
    .join("\n");
  const m = /^ {0,3}\[((?:\\.|[^\]\\]){1,999})\]:[ \t]*(?:\n[ \t]*)?/.exec(s);
  if (
    !m ||
    /(?<!\\)\[/.test(m[1]) ||
    !normalize(m[1]) ||
    (ctx.dialect === "stem-v1" && m[1].startsWith("^"))
  )
    return 0;
  const dest = destination(s, m[0].length);
  if (!dest || (!dest.href && s[m[0].length] !== "<")) return 0;
  let end = dest.end,
    title: string | undefined;
  const gap = /^[ \t]*(?:\n[ \t]*)?/.exec(s.slice(end))![0];
  if (gap) {
    const t = readTitle(s, end + gap.length);
    if (t && /^[ \t]*(?:\n|$)/.test(s.slice(t.end))) {
      title = t.title;
      end = t.end;
    }
  }
  if (!/^[ \t]*(?:\n|$)/.test(s.slice(end))) return 0;
  const count = s.slice(0, end).split("\n").length;
  if (!ctx.refs.has(normalize(m[1])))
    ctx.refs.set(normalize(m[1]), { href: dest.href, title });
  if (ctx.depth === 0)
    ctx.definitions.push(
      node(
        "referenceDefinition",
        lines[index].from,
        lines[index + count - 1].to,
        { key: m[1], href: dest.href, title },
      ),
    );
  return count;
}
function cells(text: string) {
  let t = text.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (/(?<!\\)\|$/.test(t)) t = t.slice(0, -1);
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "\\" && t[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (t[i] === "|") {
      out.push(cur.trim());
      cur = "";
    } else cur += t[i];
  }
  out.push(cur.trim());
  return out;
}
function lastParagraph(nodes: N[]): boolean {
  const last = nodes.at(-1);
  return (
    !!last &&
    (last.type === "paragraph" ||
      (["list", "item", "blockquote"].includes(last.type) &&
        lastParagraph(last.children ?? [])))
  );
}

// A table's display text may omit escapes, but every character still maps to
// the original source. The editor and portable-link rewrites use these spans.
function tableCellNodes(line: Line, count: number): N[] {
  let start = line.text.search(/\S/),
    end = line.text.trimEnd().length;
  if (start < 0) start = end;
  if (line.text[start] === "|") start++;
  if (line.text[end - 1] === "|" && line.text[end - 2] !== "\\") end--;
  const result: N[] = [];
  let value = "",
    positions: number[] = [],
    fieldStart = start;
  const push = (boundary: number) => {
    const leading = value.length - value.trimStart().length;
    const text = value.trim(),
      mapped = positions.slice(leading, leading + text.length);
    const from =
        mapped[0] ??
        line.from + fieldStart + Math.ceil((boundary - fieldStart) / 2),
      to = mapped.length ? mapped[mapped.length - 1] + 1 : from;
    const cell = node("tableCell", from, to, {
      text,
      contentFrom: from,
      contentTo: to,
    });
    inlinePositions.set(cell, [...mapped, to]);
    result.push(cell);
    value = "";
    positions = [];
    fieldStart = boundary + 1;
  };
  for (let i = start; i < end; i++) {
    if (line.text[i] === "\\" && line.text[i + 1] === "|") i++;
    else if (line.text[i] === "|") {
      push(i);
      continue;
    }
    value += line.text[i];
    positions.push(line.from + i);
  }
  push(end);
  while (result.length < count)
    result.push(
      node("tableCell", line.from + end, line.from + end, { text: "" }),
    );
  return result.slice(0, count);
}

function trimInlinePrefix(n: N, length: number) {
  n.text = n.text!.slice(length);
  const positions = inlinePositions.get(n)?.slice(length);
  if (positions) inlinePositions.set(n, positions);
  n.contentFrom = positions?.[0] ?? (n.contentFrom ?? n.from) + length;
}

function blocks(lines: Line[], ctx: Context): N[] {
  const out: N[] = [];
  ctx.budget.remaining -= lines.length;
  if (ctx.depth > 64 || ctx.budget.remaining < 0) {
    ctx.budget.limited = true;
    return lines.length
      ? [
          node("paragraph", lines[0].from, lines.at(-1)!.to, {
            text: lines.map((l) => l.text).join("\n"),
          }),
        ]
      : [];
  }
  // A complete display equation can interrupt prose, including stripped quote
  // and list content. Index closing fences once: repeated unmatched openers must
  // not turn paragraph lookahead into a quadratic scan. Lazy lines belong to a
  // different container and cannot supply a closing fence or equation body.
  const mathClosers = new Map<string, number[]>();
  const displayAt = (index: number) => {
    const line = lines[index];
    if (ctx.dialect !== "stem-v1" || line.lazy) return null;
    const opening = /^ {0,3}(\$\$|\\\[)/.exec(line.text);
    if (!opening) return null;
    const marker = opening[1],
      leading = opening[0].length - marker.length,
      first = line.text.slice(leading + 2),
      close = marker === "$$" ? "$$" : "\\]";
    const inlineEnd =
      marker === "$$"
        ? (/\$\$[ \t]*$/.exec(first)?.index ?? -1)
        : escapedMathClose(first, 0, "]");
    if (inlineEnd >= 0 && /^[ \t]*$/.test(first.slice(inlineEnd + 2)))
      return { end: index, leading, text: first.slice(0, inlineEnd) };
    if (first.trim()) return null;
    if (!mathClosers.has(close)) {
      const closers: number[] = [];
      const closingLine =
        close === "$$" ? /^ {0,3}\$\$[ \t]*$/ : /^ {0,3}\\\][ \t]*$/;
      let next = -1;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].lazy) next = -1;
        closers[i] = next;
        if (!lines[i].lazy && closingLine.test(lines[i].text)) next = i;
      }
      mathClosers.set(close, closers);
    }
    const end = mathClosers.get(close)![index];
    return end < 0 ? null : { end, leading, text: undefined };
  };
  for (let i = 0; i < lines.length;) {
    const l = lines[i],
      s = l.text;
    // Passive metadata only: no YAML execution, interpolation or configuration effects.
    if (
      ctx.dialect === "stem-v1" &&
      ctx.depth === 0 &&
      l.from === 0 &&
      s === "---"
    ) {
      let end = i + 1;
      while (
        end < lines.length &&
        end < 512 &&
        !/^(?:---|\.\.\.)\s*$/.test(lines[end].text)
      )
        end++;
      if (
        end < lines.length &&
        end < 512 &&
        lines.slice(i + 1, end).some((line) => /^[\w.-]+\s*:/.test(line.text))
      ) {
        out.push(
          node("frontmatter", l.from, lines[end].to, {
            text: lines
              .slice(i + 1, end)
              .map((line) => line.text)
              .join("\n"),
          }),
        );
        i = end + 1;
        continue;
      }
    }
    if (ctx.dialect === "stem-v1" && /^\s*\[toc\]\s*$/i.test(s)) {
      out.push(node("toc", l.from, l.to));
      i++;
      continue;
    }
    if (blank(s)) {
      i++;
      continue;
    }
    const defCount = definition(lines, i, ctx);
    if (defCount) {
      i += defCount;
      continue;
    }
    if (ctx.dialect === "stem-v1") {
      const fn = /^ {0,3}\[\^([^\]]+)\]:[ \t]*(.*)$/.exec(s);
      if (fn) {
        const contents: Line[] = [
          {
            ...l,
            text: fn[2],
            from: l.from + s.indexOf(fn[2], s.indexOf(":") + 1),
          },
        ];
        let j = i + 1;
        while (j < lines.length) {
          const current = lines[j];
          if (indent(current.text) >= 4 || blank(current.text)) {
            contents.push(strip(lines[j++], 4));
            continue;
          }
          // Wrapped prose may omit indentation, like lazy list/quote prose.
          // It cannot start a new block, cross a blank separator or supply a
          // math/code fence. Probe only the first lazy line in each run.
          if (
            !blank(contents.at(-1)!.text) &&
            !interrupts(current.text) &&
            !/^ {0,3}(?:\[[^\]]+\]:|\$\$|\\\[|=+[ \t]*$)/.test(current.text) &&
            (contents.at(-1)!.lazy ||
              lastParagraph(
                blocks(contents, {
                  ...ctx,
                  refs: new Map(ctx.refs),
                  footnotes: { ...ctx.footnotes },
                  definitions: [],
                  depth: ctx.depth + 1,
                }),
              ))
          ) {
            contents.push({ ...current, lazy: true });
            j++;
            continue;
          }
          break;
        }
        ctx.footnotes[fn[1]] = blocks(contents, {
          ...ctx,
          depth: ctx.depth + 1,
        });
        if (ctx.depth === 0)
          ctx.definitions.push(
            node("footnoteDefinition", l.from, lines[j - 1].to, {
              key: fn[1],
              children: ctx.footnotes[fn[1]],
            }),
          );
        i = j;
        continue;
      }
      const display = displayAt(i);
      if (display) {
        if (display.text !== undefined) {
          out.push(
            node("mathBlock", l.from, l.to, {
              text: display.text,
              contentFrom: l.from + display.leading + 2,
              contentTo: l.from + display.leading + 2 + display.text.length,
            }),
          );
          i++;
          continue;
        }
        const j = display.end;
        out.push(
          node("mathBlock", l.from, lines[j].to, {
            text: lines
              .slice(i + 1, j)
              .map((x) => x.text)
              .join("\n"),
            contentFrom: l.to,
            contentTo: lines[j].from,
          }),
        );
        i = j + 1;
        continue;
      }
    }
    const f = fence(s);
    if (f) {
      const n = s.indexOf(f[1]);
      let j = i + 1;
      const body: string[] = [];
      const close = new RegExp(
        "^ {0,3}" +
          (f[1][0] === "`" ? "`" : "~") +
          "{" +
          f[1].length +
          ",}[ \\t]*$",
      );
      while (j < lines.length && !close.test(lines[j].text)) {
        body.push(strip(lines[j], n).text);
        j++;
      }
      out.push(
        node("codeBlock", l.from, (lines[j] ?? lines[j - 1]).to, {
          text: body.length ? body.join("\n") + "\n" : "",
          lang: unescape(f[2].trim()).split(/\s/)[0],
          contentFrom: l.to,
          contentTo: lines[j]?.from ?? lines.at(-1)!.to,
        }),
      );
      i = j < lines.length ? j + 1 : j;
      continue;
    }
    const h = atx(s);
    if (h) {
      const value = h[2].replace(/(?:^|[ \t]+)#+[ \t]*$/, "").trim();
      const start =
        l.from +
        s.indexOf(h[2], s.indexOf(h[1]) + h[1].length) +
        h[2].indexOf(value);
      out.push(
        node("heading", l.from, l.to, {
          text: value,
          level: h[1].length,
          contentFrom: start,
          contentTo: start + value.length,
        }),
      );
      i++;
      continue;
    }
    if (hr(s)) {
      out.push(node("hr", l.from, l.to));
      i++;
      continue;
    }
    if (/^ {0,3}>/.test(s)) {
      const content: Line[] = [];
      let j = i;
      while (j < lines.length) {
        const q = /^ {0,3}>/.exec(lines[j].text);
        if (q) {
          const rest = {
            ...lines[j],
            from: lines[j].from + q[0].length,
            text: lines[j].text.slice(q[0].length),
          };
          if (rest.text[0] === "\t") {
            const col = 4 - (q[0].length % 4);
            content.push({
              ...rest,
              text: " ".repeat(col - 1) + rest.text.slice(1),
              from: rest.from + 2 - col,
              column: q[0].length + 1,
            });
          } else
            content.push(
              rest.text.startsWith(" ")
                ? { ...rest, text: rest.text.slice(1), from: rest.from + 1 }
                : rest,
            );
          j++;
        } else if (
          !blank(lines[j].text) &&
          content.length &&
          !blank(content.at(-1)!.text) &&
          !interrupts(lines[j].text) &&
          !displayAt(j) &&
          (!/^ {0,3}=+[ \t]*$/.test(lines[j].text) || content.at(-1)!.lazy) &&
          (content.at(-1)!.lazy ||
            lastParagraph(
              blocks(content, {
                ...ctx,
                refs: new Map(ctx.refs),
                depth: ctx.depth + 1,
              }),
            ))
        ) {
          content.push({ ...lines[j++], lazy: true });
        } else break;
      }
      const children = blocks(content, { ...ctx, depth: ctx.depth + 1 });
      let type = "blockquote",
        kind: string | undefined,
        title: string | undefined;
      if (ctx.dialect === "stem-v1" && children[0]?.type === "paragraph") {
        const c = /^\[!([A-Za-z]+)\][ \t]*([^\n]*)(?:\n|$)/.exec(
          children[0].text ?? "",
        );
        if (c) {
          type = "callout";
          kind = c[1].toLowerCase();
          title = c[2] || kind[0].toUpperCase() + kind.slice(1);
          trimInlinePrefix(children[0], c[0].length);
          if (!children[0].text) children.shift();
        }
      }
      out.push(node(type, l.from, lines[j - 1].to, { children, kind, title }));
      i = j;
      continue;
    }
    const marker = listMarker(s);
    if (marker) {
      const items: N[] = [];
      let j = i,
        tight = true,
        priorBlank = false;
      while (j < lines.length) {
        const m = listMarker(lines[j].text);
        if (!m || m.marker !== marker.marker || m.ordered !== marker.ordered)
          break;
        if (items.length && priorBlank) tight = false;
        const first = lines[j],
          content = [stripMarker(first, m.width)];
        j++;
        let trailingBlank = false,
          lastWasLazy = false;
        while (j < lines.length) {
          const current = lines[j],
            nextMarker = listMarker(current.text);
          if (blank(current.text)) {
            lastWasLazy = false;
            content.push({ ...current, text: "" });
            j++;
            trailingBlank = true;
            if (content.length === 2 && blank(content[0].text)) break;
            continue;
          }
          if (indent(current.text) >= m.width) {
            lastWasLazy = false;
            content.push(strip(current, m.width));
            j++;
            trailingBlank = false;
            continue;
          }
          if (nextMarker) break;
          if (
            !trailingBlank &&
            !interrupts(current.text) &&
            !displayAt(j) &&
            (lastWasLazy ||
              lastParagraph(
                blocks(content, {
                  ...ctx,
                  refs: new Map(ctx.refs),
                  depth: ctx.depth + 1,
                }),
              ))
          ) {
            content.push({ ...current, lazy: true });
            lastWasLazy = true;
            j++;
            continue;
          }
          break;
        }
        const children = blocks(content, { ...ctx, depth: ctx.depth + 1 });
        if (
          children.length &&
          content.some(
            (v, k) =>
              blank(v.text) &&
              v.from >= children[0].to &&
              content[k + 1] &&
              /^ {0,3}\[[^\]]+\]:/.test(content[k + 1].text),
          )
        )
          tight = false;
        for (let c = 1; c < children.length; c++)
          if (
            content.some(
              (v) =>
                blank(v.text) &&
                v.from >= children[c - 1].to &&
                v.to <= children[c].from + 3,
            )
          )
            tight = false;
        const item = node("item", first.from, content.at(-1)!.to, { children });
        if (ctx.dialect !== "commonmark" && children[0]?.type === "paragraph") {
          const task = /^\[([ xX])\](?:[ \t]+|$)/.exec(children[0].text ?? "");
          if (task) {
            item.checked = task[1] !== " ";
            trimInlinePrefix(children[0], task[0].length);
          }
        }
        items.push(item);
        priorBlank = trailingBlank;
      }
      out.push(
        node(
          "list",
          l.from,
          [...lines.slice(i, j)].reverse().find((v) => !blank(v.text))!.to,
          {
            ordered: marker.ordered,
            start: marker.start,
            tight,
            children: items,
          },
        ),
      );
      i = j;
      continue;
    }
    const html = htmlBlock(s);
    if (html) {
      let j = i;
      while (j < lines.length && (html.end || !blank(lines[j].text))) {
        const done = html.end?.test(lines[j].text);
        j++;
        if (done) break;
      }
      out.push(
        node("htmlBlock", l.from, lines[j - 1].to, {
          text:
            lines
              .slice(i, j)
              .map((v) => v.text)
              .join("\n") + "\n",
        }),
      );
      i = j;
      continue;
    }
    if (indent(s) >= 4) {
      let j = i;
      const body: Line[] = [];
      while (
        j < lines.length &&
        (indent(lines[j].text) >= 4 || blank(lines[j].text))
      )
        body.push(strip(lines[j++], 4));
      while (body.length && blank(body.at(-1)!.text)) body.pop();
      out.push(
        node("codeBlock", l.from, body.at(-1)!.to, {
          text: body.map((v) => v.text).join("\n") + "\n",
          lang: "",
        }),
      );
      i = j;
      continue;
    }
    if (
      ctx.dialect !== "commonmark" &&
      i + 1 < lines.length &&
      s.includes("|")
    ) {
      const header = cells(s),
        sep = cells(lines[i + 1].text);
      if (
        sep.length === header.length &&
        sep.every((c) => /^:?-+:?$/.test(c))
      ) {
        let j = i + 2;
        const rows = [
          node("tableRow", l.from, l.to, {
            children: tableCellNodes(l, header.length),
          }),
        ];
        while (
          j < lines.length &&
          !blank(lines[j].text) &&
          !interrupts(lines[j].text) &&
          !displayAt(j)
        ) {
          rows.push(
            node("tableRow", lines[j].from, lines[j].to, {
              children: tableCellNodes(lines[j], header.length),
            }),
          );
          j++;
        }
        out.push(
          node("table", l.from, lines[j - 1].to, {
            children: rows,
            align: sep.map((t) =>
              t.startsWith(":") && t.endsWith(":")
                ? "center"
                : t.endsWith(":")
                  ? "right"
                  : t.startsWith(":")
                    ? "left"
                    : "",
            ),
          }),
        );
        i = j;
        continue;
      }
    }
    const para: Line[] = [l];
    let j = i + 1,
      heading = 0;
    while (j < lines.length && !blank(lines[j].text)) {
      if (!lines[j].lazy && /^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[j].text)) {
        heading = lines[j].text.trim()[0] === "=" ? 1 : 2;
        j++;
        break;
      }
      if (interrupts(lines[j].text) || displayAt(j)) break;
      para.push(lines[j++]);
    }
    const combined = combine(para);
    const n = node(heading ? "heading" : "paragraph", l.from, lines[j - 1].to, {
      text: combined.text,
      level: heading || undefined,
      contentFrom: combined.positions[0],
      contentTo: combined.positions[combined.text.length - 1] + 1,
    });
    inlinePositions.set(n, combined.positions);
    out.push(n);
    i = j;
  }
  return out;
}
const inlinePositions = new WeakMap<N, number[]>();

/** Skip escaped backslash pairs when looking for a TeX closing delimiter. */
function escapedMathClose(text: string, from: number, closing: ")" | "]") {
  for (let at = from; at < text.length; at++) {
    if (text[at] !== "\\") continue;
    if (text[at + 1] === closing) return at;
    at++; // A doubled backslash cannot introduce a math closer.
  }
  return -1;
}

function inlines(
  s: string,
  ctx: Context,
  base = 0,
  positions?: number[],
  allowLinks = true,
  nesting = 0,
): N[] {
  const result: N[] = [],
    p = (i: number) => positions?.[i] ?? base + i;
  const fallback = () => {
    ctx.budget.limited = true;
    return [
      node("text", p(0), p(Math.max(0, s.length - 1)) + (s.length ? 1 : 0), {
        text: s,
      }),
    ];
  };
  ctx.budget.remaining -= s.length;
  if (nesting > 64 || ctx.budget.remaining < 0) return fallback();
  const hasWikiClose = s.includes("]]");
  // Searches advance monotonically; unmatched openers do not rescan the suffix.
  let parenClose: number | undefined;
  const add = (
    type: string,
    start: number,
    end: number,
    props: Partial<N> = {},
  ) => {
    result.push(node(type, p(start), p(end - 1) + 1, props));
  };
  const literal = (text: string, start: number, end: number) =>
    add("text", start, end, { text });
  for (let i = 0; i < s.length;) {
    if (--ctx.budget.remaining < 0) return fallback();
    const c = s[i];
    if (c === "\n") {
      const prior = result.at(-1);
      if (prior?.type === "text" && / {2,}$/.test(prior.text ?? "")) {
        prior.text = prior.text!.trimEnd();
        add("hardbreak", i, i + 1);
      } else {
        if (prior?.type === "text")
          prior.text = prior.text!.replace(/[ \t]+$/, "");
        add("softbreak", i, i + 1);
      }
      i++;
      continue;
    }
    if (c === "\\") {
      if (ctx.dialect === "stem-v1") {
        if (s[i + 1] === "(") {
          if (
            parenClose === undefined ||
            (parenClose >= 0 && parenClose < i + 2)
          )
            parenClose = escapedMathClose(s, i + 2, ")");
          if (parenClose >= 0) {
            add("mathInline", i, parenClose + 2, {
              text: s.slice(i + 2, parenClose),
              contentFrom: p(i + 2),
              contentTo: p(parenClose),
            });
            i = parenClose + 2;
            continue;
          }
        }
        const eq = /^\\eqref\{([^}]+)\}/.exec(s.slice(i));
        if (eq) {
          add("equationRef", i, i + eq[0].length, { key: eq[1] });
          i += eq[0].length;
          continue;
        }
      }
      if (s[i + 1] === "\n") {
        add("hardbreak", i, i + 2);
        i += 2;
        continue;
      }
      if (s[i + 1] && /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.test(s[i + 1])) {
        literal(s[i + 1], i, i + 2);
        i += 2;
        continue;
      }
    }
    if (c === "&") {
      const entity =
        /^&(?:#[xX][a-fA-F0-9]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/.exec(
          s.slice(i),
        );
      if (entity) {
        literal(decodeHTMLStrict(entity[0]), i, i + entity[0].length);
        i += entity[0].length;
        continue;
      }
    }
    if (c === "`") {
      let len = 1;
      while (s[i + len] === "`") len++;
      let j = i + len,
        close = -1;
      while (j < s.length) {
        if (--ctx.budget.remaining < 0) return fallback();
        if (s[j] !== "`") {
          j++;
          continue;
        }
        let count = 1;
        while (s[j + count] === "`") count++;
        if (count === len) {
          close = j;
          break;
        }
        j += count;
      }
      if (close >= 0) {
        let value = s.slice(i + len, close).replace(/\n/g, " ");
        if (value.startsWith(" ") && value.endsWith(" ") && /[^ ]/.test(value))
          value = value.slice(1, -1);
        add("code", i, close + len, {
          text: value,
          contentFrom: p(i + len),
          contentTo: p(close),
        });
        i = close + len;
        continue;
      }
      literal("`".repeat(len), i, i + len);
      i += len;
      continue;
    }
    if (ctx.dialect === "stem-v1") {
      if ((c === "~" || c === "^") && s[i + 1] !== c) {
        const match = new RegExp(
          "^\\" + c + "((?:\\\\.|[^\\" + c + "\\s])+?)\\" + c,
        ).exec(s.slice(i));
        if (match) {
          add(c === "~" ? "subscript" : "superscript", i, i + match[0].length, {
            children: inlines(
              match[1],
              ctx,
              p(i + 1),
              positions?.slice(i + 1, i + match[0].length - 1),
              allowLinks,
              nesting + 1,
            ),
            contentFrom: p(i + 1),
            contentTo: p(i + match[0].length - 1),
          });
          i += match[0].length;
          continue;
        }
      }
      if (c === ":") {
        const match = /^:([a-z0-9_+-]+):/.exec(s.slice(i));
        const aliases: Record<string, string> = {
          smile: "😄",
          smiling_face: "☺️",
          grin: "😁",
          joy: "😂",
          thinking: "🤔",
          thinking_face: "🤔",
          warning: "⚠️",
          bulb: "💡",
          memo: "📝",
          microscope: "🔬",
          test_tube: "🧪",
          atom: "⚛️",
          rocket: "🚀",
          check: "✅",
          white_check_mark: "✅",
          x: "❌",
          heavy_check_mark: "✔️",
          star: "⭐",
          eyes: "👀",
          thumbsup: "👍",
          "+1": "👍",
          heart: "❤️",
          fire: "🔥",
          chart_with_upwards_trend: "📈",
          books: "📚",
          computer: "💻",
          link: "🔗",
          question: "❓",
        };
        if (match && aliases[match[1]]) {
          add("emoji", i, i + match[0].length, {
            text: aliases[match[1]],
            key: match[1],
          });
          i += match[0].length;
          continue;
        }
      }
      if (s.startsWith("<u>", i)) {
        const end = s.indexOf("</u>", i + 3);
        if (end >= 0 && !s.slice(i + 3, end).includes("\n")) {
          add("underline", i, end + 4, {
            children: inlines(
              s.slice(i + 3, end),
              ctx,
              p(i + 3),
              positions?.slice(i + 3, end + 1),
              allowLinks,
              nesting + 1,
            ),
            contentFrom: p(i + 3),
            contentTo: p(end),
          });
          i = end + 4;
          continue;
        }
      }
      if (c === "$" && s[i + 1] !== "$" && !whitespace(s[i + 1])) {
        let j = i + 1;
        while (j < s.length && s[j] !== "\n") {
          if (--ctx.budget.remaining < 0) return fallback();
          if (s[j] === "\\") {
            j += 2;
            continue;
          }
          if (
            s[j] === "$" &&
            !whitespace(s[j - 1]) &&
            !/\d/.test(s[j + 1] ?? "")
          )
            break;
          j++;
        }
        if (s[j] === "$") {
          add("mathInline", i, j + 1, {
            text: s.slice(i + 1, j),
            contentFrom: p(i + 1),
            contentTo: p(j),
          });
          i = j + 1;
          continue;
        }
      }
      const wiki =
        hasWikiClose &&
        c === "[" &&
        s[i + 1] === "[" &&
        /^\[\[([^\]\n]+)\]\]/.exec(s.slice(i));
      if (wiki) {
        const [target, ...label] = wiki[1].split("|");
        add("wikiLink", i, i + wiki[0].length, {
          href: target,
          text: label.join("|") || target,
        });
        i += wiki[0].length;
        continue;
      }
      const cite = /^\[(@[\w:./-]+(?:\s*;\s*@[\w:./-]+)*)\]/.exec(s.slice(i));
      if (cite) {
        add("citation", i, i + cite[0].length, {
          key: cite[1].replace(/@/g, "").replace(/\s/g, ""),
        });
        i += cite[0].length;
        continue;
      }
      const fn = /^\[\^([^\]\n]+)\]/.exec(s.slice(i));
      if (fn && ctx.footnotes[fn[1]]) {
        add("footnoteRef", i, i + fn[0].length, { key: fn[1] });
        i += fn[0].length;
        continue;
      }
    }
    if (c === "[" || (c === "!" && s[i + 1] === "[")) {
      const image = c === "!",
        start = i + (image ? 2 : 1);
      let j = start,
        depth = 0;
      for (; j < s.length; j++) {
        if (--ctx.budget.remaining < 0) return fallback();
        if (s[j] === "\\") {
          j++;
          continue;
        }
        if (s[j] === "<") {
          const angle =
            tagRE.exec(s.slice(j)) ||
            /^<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\x00-\x20]*>/.exec(s.slice(j));
          if (angle) {
            j += angle[0].length - 1;
            continue;
          }
        }
        if (s[j] === "`") {
          const ticks = /^`+/.exec(s.slice(j))![0];
          const end = s.indexOf(ticks, j + ticks.length);
          if (end >= 0) {
            j = end + ticks.length - 1;
            continue;
          }
        }
        if (s[j] === "[") depth++;
        if (s[j] === "]") {
          if (!depth) break;
          depth--;
        }
      }
      if (j < s.length) {
        const label = s.slice(start, j);
        let end = j + 1,
          ref: Ref | undefined;
        if (s[end] === "(") {
          const ws = /^[ \t\n]*/.exec(s.slice(end + 1))![0].length,
            d = destination(s, end + 1 + ws);
          if (d) {
            let k = d.end;
            const gap = /^[ \t\n]*/.exec(s.slice(k))![0].length;
            k += gap;
            let title: string | undefined;
            if (gap && s[k] !== ")") {
              const t = readTitle(s, k);
              if (t) {
                title = t.title;
                k = t.end + /^[ \t\n]*/.exec(s.slice(t.end))![0].length;
              }
            }
            if (s[k] === ")") {
              ref = { href: d.href, title };
              end = k + 1;
            }
          }
        }
        if (!ref) {
          const explicit = /^\[((?:\\.|[^\]\\])*)\]/.exec(s.slice(j + 1));
          if (explicit) {
            ref = ctx.refs.get(normalize(explicit[1] || label));
            if (ref) end = j + 1 + explicit[0].length;
          } else ref = ctx.refs.get(normalize(label));
        }
        if (ref && (image || allowLinks)) {
          const children = inlines(
            label,
            ctx,
            p(start),
            positions?.slice(start, j + 1),
            true,
            nesting + 1,
          );
          const hasLink = (nodes: N[]): boolean =>
            nodes.some((n) => n.type === "link" || hasLink(n.children ?? []));
          if (image || !hasLink(children)) {
            add(image ? "image" : "link", i, end, {
              ...ref,
              children,
              contentFrom: p(start),
              contentTo: p(j),
            });
            i = end;
            continue;
          }
        }
      }
    }
    if (c === "<") {
      const auto = /^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\x00-\x20]*)>/.exec(
        s.slice(i),
      );
      const email =
        /^<([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/.exec(
          s.slice(i),
        );
      if ((auto || email) && allowLinks) {
        const m = (auto || email)!;
        add("link", i, i + m[0].length, {
          href: (email ? "mailto:" : "") + m[1],
          children: [
            node("text", p(i + 1), p(i + m[0].length - 1), { text: m[1] }),
          ],
        });
        i += m[0].length;
        continue;
      }
      const raw =
        tagRE.exec(s.slice(i)) ||
        /^(?:<!--(?:>|->|[\s\S]*?-->)|<\?[\s\S]*?\?>|<![A-Z][\s\S]*?>|<!\[CDATA\[[\s\S]*?\]\]>)/.exec(
          s.slice(i),
        );
      if (raw) {
        add("html", i, i + raw[0].length, { text: raw[0] });
        i += raw[0].length;
        continue;
      }
    }
    if (
      ctx.dialect !== "commonmark" &&
      allowLinks &&
      (i === 0 || /[\s([*_~]/.test(s[i - 1]))
    ) {
      const match =
        /^(?:(?:(?:https?|ftp):\/\/|www\.)[^\s<>]+|[A-Za-z0-9._+\-]+@[A-Za-z0-9._-]+\.[A-Za-z0-9_-]+)/.exec(
          s.slice(i),
        );
      if (match) {
        let url = match[0]
          .replace(/[?!.,:*_~]+$/, "")
          .replace(/&(?:[A-Za-z0-9]+);$/, "");
        while (
          url.endsWith(")") &&
          (url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0)
        )
          url = url.slice(0, -1);
        const email =
          !url.includes("://") && !url.startsWith("www.") && url.includes("@");
        const domain = email
          ? match[0].split("@")[1].replace(/\.+$/, "")
          : url.replace(/^(?:https?|ftp):\/\/|^www\./, "").split("/")[0];
        if (
          domain.includes(".") &&
          !/_[^/]*$/.test(domain) &&
          !(email && /[-_]$/.test(domain))
        ) {
          add("link", i, i + url.length, {
            href: url.startsWith("www.")
              ? "http://" + url
              : url.includes("@") && !url.includes("://")
                ? "mailto:" + url
                : url,
            children: [
              node("text", p(i), p(i + url.length - 1) + 1, { text: url }),
            ],
          });
          i += url.length;
          continue;
        }
      }
    }
    if (
      c === "*" ||
      c === "_" ||
      (c === "~" && ctx.dialect !== "commonmark") ||
      (c === "=" && ctx.dialect === "stem-v1")
    ) {
      let count = 1;
      while (s[i + count] === c) count++;
      const before = i
          ? String.fromCodePoint(
              s.codePointAt(
                i -
                  (s.charCodeAt(i - 1) >= 0xdc00 &&
                  s.charCodeAt(i - 1) <= 0xdfff
                    ? 2
                    : 1),
              )!,
            )
          : "",
        after = s[i + count]
          ? String.fromCodePoint(s.codePointAt(i + count)!)
          : "";
      const left =
        !whitespace(after) &&
        (!punctuation(after) || whitespace(before) || punctuation(before));
      const right =
        !whitespace(before) &&
        (!punctuation(before) || whitespace(after) || punctuation(after));
      if ((c === "~" || c === "=") && count !== 2)
        literal(c.repeat(count), i, i + count);
      else
        add("delimiter", i, i + count, {
          text: c.repeat(count),
          marker: c,
          count,
          open: c === "_" ? left && (!right || punctuation(before)) : left,
          close: c === "_" ? right && (!left || punctuation(after)) : right,
        });
      i += count;
      continue;
    }
    let end = i + 1;
    while (
      end < s.length &&
      !/[\n\\&`\[!<*_~=$]/.test(s[end]) &&
      !(ctx.dialect === "stem-v1" && /[\^:]/.test(s[end])) &&
      !(
        ctx.dialect !== "commonmark" &&
        /[\s([*_~]/.test(s[end - 1]) &&
        /[A-Za-z0-9]/.test(s[end])
      )
    )
      end++;
    literal(s.slice(i, end).replace(/\u0000/g, "\ufffd"), i, end);
    i = end;
  }
  const depths = new WeakMap<N, number>();
  for (let close = 0; close < result.length;) {
    const closer = result[close];
    if (closer.type !== "delimiter" || !closer.close) {
      close++;
      continue;
    }
    let open = close - 1;
    for (; open >= 0; open--) {
      if (--ctx.budget.remaining < 0) return fallback();
      const a = result[open];
      if (a.type !== "delimiter" || !a.open || a.marker !== closer.marker)
        continue;
      if (
        (a.close || closer.open) &&
        (a.count! + closer.count!) % 3 === 0 &&
        (a.count! % 3 !== 0 || closer.count! % 3 !== 0) &&
        a.marker !== "~" &&
        a.marker !== "="
      )
        continue;
      break;
    }
    if (open < 0) {
      close++;
      continue;
    }
    const opener = result[open],
      use = Math.min(opener.count!, closer.count!) >= 2 ? 2 : 1;
    const type =
      opener.marker === "~"
        ? "strike"
        : opener.marker === "="
          ? "highlight"
          : use === 2
            ? "strong"
            : "em";
    const children = result
      .slice(open + 1, close)
      .map((n) => (n.type === "delimiter" ? { ...n, type: "text" } : n));
    const wrapped = node(type, opener.to - use, closer.from + use, {
      children,
      contentFrom: opener.to,
      contentTo: closer.from,
    });
    const depth =
      children.reduce(
        (max, child) => Math.max(max, depths.get(child) ?? 0),
        0,
      ) + 1;
    if (depth > 64) return fallback();
    depths.set(wrapped, depth);
    opener.count! -= use;
    opener.to -= use;
    opener.text = opener.marker!.repeat(opener.count!);
    closer.count! -= use;
    closer.from += use;
    closer.text = closer.marker!.repeat(closer.count!);
    const replacement = [
      ...(opener.count ? [opener] : []),
      wrapped,
      ...(closer.count ? [closer] : []),
    ];
    result.splice(open, close - open + 1, ...replacement);
    close = open + replacement.length - (closer.count ? 1 : 0);
  }
  return result
    .filter((n) => n.type !== "text" || n.text)
    .map((n) => (n.type === "delimiter" ? { ...n, type: "text" } : n));
}
export function plainText(n: N): string {
  return n.children
    ? n.children
        .map(plainText)
        .join(
          [
            "document",
            "blockquote",
            "callout",
            "list",
            "listItem",
            "table",
            "tableRow",
          ].includes(n.type)
            ? "\n"
            : "",
        )
    : n.type.endsWith("break")
      ? "\n"
      : (n.text ?? "");
}
export function slug(text: string) {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s+/g, "-") || "section"
  );
}
export function parseMarkdown(
  source: string,
  dialect: Dialect = "stem-v1",
): ParsedDocument {
  const ctx: Context = {
    dialect,
    refs: new Map(),
    footnotes: {},
    definitions: [],
    depth: 0,
    budget: {
      remaining: Math.min(8000000, Math.max(100000, source.length * 40)),
      limited: false,
    },
  };
  const ast = node("document", 0, source.length, {
    kind: dialect,
    children: blocks(linesOf(source), ctx),
  });
  const parsed: ParsedDocument = {
    ast,
    diagnostics: [],
    outline: [],
    links: [],
    citations: [],
    footnotes: ctx.footnotes,
    definitions: ctx.definitions,
  };
  const usedSlugs = new Map<string, number>();
  const visit = (n: N) => {
    if (["paragraph", "heading", "tableCell"].includes(n.type))
      n.children = inlines(
        n.text ?? "",
        ctx,
        n.contentFrom ?? n.from,
        inlinePositions.get(n),
      );
    if (n.type === "tableCell" && dialect === "stem-v1") {
      const breaks = (child: N) => {
        if (child.type === "html" && /^<br\s*\/?>$/i.test(child.text ?? ""))
          child.type = "tableBreak";
        child.children?.forEach(breaks);
      };
      n.children?.forEach(breaks);
    }
    if (n.type === "heading") {
      const text = plainText(n),
        id = slug(text),
        num = usedSlugs.get(id) ?? 0;
      usedSlugs.set(id, num + 1);
      n.key = num ? `${id}-${num}` : id;
      parsed.outline.push({ level: n.level!, text, id: n.key, from: n.from });
    }
    if (n.type === "wikiLink" || n.type === "link")
      parsed.links.push({
        target: n.href!,
        label: plainText(n),
        from: n.from,
        to: n.to,
      });
    if (n.type === "citation")
      for (const key of n.key!.split(";"))
        if (!parsed.citations.includes(key)) parsed.citations.push(key);
    n.children?.forEach(visit);
  };
  visit(ast);
  Object.values(ctx.footnotes).forEach((ns) => ns.forEach(visit));
  if (ctx.budget.limited)
    parsed.diagnostics.push({
      from: 0,
      to: source.length,
      severity: "warning",
      message:
        "Exceptionally complex Markdown is displayed literally. Simplify deeply nested or unmatched delimiters to enable its formatting.",
    });
  return parsed;
}
