export type DocumentationLink = { target: string; line: number };

const blank = (value: string) => value.replace(/[^\n]/g, " ");
const entities: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
};

// URL tokens may contain commas (notably data URLs); descriptors end at a comma.
function srcsetTargets(value: string) {
  const targets: string[] = [];
  let rest = value;
  while (rest) {
    rest = rest.replace(/^[\s,]+/, "");
    const token = rest.match(/^\S+/)?.[0];
    if (!token) break;
    targets.push(token.replace(/,+$/, ""));
    rest = rest.slice(token.length);
    if (!token.endsWith(",")) {
      const comma = rest.indexOf(",");
      rest = comma < 0 ? "" : rest.slice(comma + 1);
    }
  }
  return targets;
}

/** Local links used by our Markdown guides, including README picture elements. */
export function documentationLinks(markdown: string): DocumentationLink[] {
  let fence: { marker: string; length: number } | undefined;
  const content = markdown
    .replace(/<!--[\s\S]*?-->/g, blank)
    .split("\n")
    .map((line) => {
      const match = line.trimStart().match(/^(\u0060{3,}|~{3,})(.*)$/);
      if (fence) {
        if (
          match &&
          match[1][0] === fence.marker &&
          match[1].length >= fence.length &&
          !match[2].trim()
        )
          fence = undefined;
        return blank(line);
      }
      if (match) {
        fence = { marker: match[1][0], length: match[1].length };
        return blank(line);
      }
      return line.replace(/(\u0060+).*?\1/g, blank);
    })
    .join("\n");
  const result: DocumentationLink[] = [];
  const add = (target: string, index: number) => {
    target = target
      .replace(/&(amp|quot|apos|lt|gt);/g, (_, name: string) => entities[name])
      .trim();
    if (!target || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) return;
    result.push({ target, line: content.slice(0, index).split("\n").length });
  };
  for (const match of content.matchAll(
    /\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g,
  ))
    add(match[1] ?? match[2], match.index);
  for (const match of content.matchAll(
    /^[ \t]*\[(?!\^)[^\]\n]+\]:[ \t]*(?:<([^>\n]+)>|([^\s]+))/gm,
  ))
    add(match[1] ?? match[2], match.index);
  for (const tag of content.matchAll(
    /<(?:img|source|a|video|audio|link)\b[^>]*>/gi,
  ))
    for (const attr of tag[0].matchAll(
      /\s(src|srcset|href|poster)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi,
    )) {
      const value = attr[2] ?? attr[3];
      for (const target of attr[1].toLowerCase() === "srcset"
        ? srcsetTargets(value)
        : [value])
        add(target, tag.index + attr.index + attr[0].search(/\S/));
    }
  return result.sort((a, b) => a.line - b.line);
}
