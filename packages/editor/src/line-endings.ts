import type { SourceEdit } from "@axiom/markdown";
import { applyChanges, type SourceSelection } from "./transactions";

/** Run a line-oriented command against LF coordinates, then map only its edits
 * back to the original Markdown. Existing CRLF and mixed endings never change. */
export function preserveLineEndings(
  source: string,
  selection: SourceSelection,
  command: (source: string, selection: SourceSelection) => SourceEdit,
): SourceEdit {
  if (!source.includes("\r\n")) return command(source, selection);
  const mapped = normalized(source);
  const before = (at: number) => {
    let lo = 0,
      hi = mapped.boundaries.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (mapped.boundaries[mid] <= at) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const edit = command(mapped.text, {
    anchor: before(selection.anchor),
    head: before(selection.head),
  });
  const changes = edit.changes.map((change) => {
    const from = mapped.boundaries[change.from];
    const next = source.indexOf("\n", from);
    const newline = next >= 0 ? next : source.lastIndexOf("\n", from - 1);
    const ending = source[newline - 1] === "\r" ? "\r\n" : "\n";
    return {
      from,
      to: mapped.boundaries[change.to],
      insert: change.insert.replace(/\n/g, ending),
    };
  });
  const after = normalized(applyChanges(source, changes)).boundaries;
  return {
    ...edit,
    changes,
    selection: {
      anchor: after[edit.selection.anchor],
      ...(edit.selection.head === undefined
        ? {}
        : { head: after[edit.selection.head] }),
    },
  };
}

function normalized(source: string) {
  let text = "";
  const boundaries = [0];
  for (let at = 0; at < source.length; at++) {
    if (source[at] === "\r" && source[at + 1] === "\n") at++;
    text += source[at];
    boundaries.push(at + 1);
  }
  return { text, boundaries };
}
