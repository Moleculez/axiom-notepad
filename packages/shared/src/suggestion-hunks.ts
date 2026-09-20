import * as Y from "yjs";
import type { SuggestionHunk } from "./revisions";
import type { TextChange } from "@axiom/markdown";
const encode = (p: Y.RelativePosition) =>
  btoa(String.fromCharCode(...Y.encodeRelativePosition(p)));
const decode = (s: string) =>
  Y.decodeRelativePosition(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
/** A source string can arrive before its CRDT identities. Never resolve a
 * server-seeded proposal against a cold or only partially synchronized document. */
export function hasSuggestionBase(doc: Y.Doc, stateVector: string): boolean {
  try {
    const required = Y.decodeStateVector(
      Uint8Array.from(atob(stateVector), (c) => c.charCodeAt(0)),
    );
    const current = Y.decodeStateVector(Y.encodeStateVector(doc));
    return [...required].every(
      ([client, clock]) => (current.get(client) ?? 0) >= clock,
    );
  } catch {
    return false;
  }
}
export function captureHunks(
  doc: Y.Doc,
  changes: TextChange[],
): SuggestionHunk[] {
  const text = doc.getText("markdown"),
    source = text.toString();
  return changes.map((c) => ({
    start: encode(Y.createRelativePositionFromTypeIndex(text, c.from, 0)),
    end: encode(
      Y.createRelativePositionFromTypeIndex(
        text,
        c.to,
        c.to === c.from ? 0 : -1,
      ),
    ),
    before: source.slice(c.from, c.to),
    insert: c.insert,
    ...(c.from === c.to
      ? {
          left: source.slice(Math.max(0, c.from - 64), c.from),
          right: source.slice(c.from, c.from + 64),
        }
      : {}),
  }));
}
export function resolveHunks(
  doc: Y.Doc,
  hunks: SuggestionHunk[],
): TextChange[] {
  const text = doc.getText("markdown"),
    source = text.toString();
  const changes = hunks
    .map((h) => {
      let a: ReturnType<typeof Y.createAbsolutePositionFromRelativePosition>,
        b: typeof a;
      try {
        a = Y.createAbsolutePositionFromRelativePosition(decode(h.start), doc);
        b = Y.createAbsolutePositionFromRelativePosition(decode(h.end), doc);
      } catch {
        throw new Error("The original selection is no longer available.");
      }
      if (
        !a ||
        !b ||
        a.type !== text ||
        b.type !== text ||
        a.index > b.index ||
        source.slice(a.index, b.index) !== h.before
      )
        throw new Error(
          "The proposed range changed. Review it before applying.",
        );
      if (
        !h.before &&
        ((h.left !== undefined && !source.slice(0, a.index).endsWith(h.left)) ||
          (h.right !== undefined && !source.slice(b.index).startsWith(h.right)))
      )
        throw new Error(
          "The insertion point changed. Review it before applying.",
        );
      return { from: a.index, to: b.index, insert: h.insert };
    })
    .sort((a, b) => a.from - b.from || a.to - b.to);
  assertDisjointChanges(changes);
  return changes;
}
export function assertDisjointChanges(changes: TextChange[]) {
  for (let i = 1; i < changes.length; i++) {
    const a = changes[i - 1],
      b = changes[i];
    if (a.to > b.from || (a.from === a.to && a.from === b.from))
      throw new Error("Selected proposals overlap. Review them individually.");
  }
}
export function applyHunks(doc: Y.Doc, changes: TextChange[], origin: unknown) {
  const text = doc.getText("markdown");
  doc.transact(() => {
    for (const c of [...changes].reverse()) {
      if (c.to > c.from) text.delete(c.from, c.to - c.from);
      if (c.insert) text.insert(c.from, c.insert);
    }
  }, origin);
}
