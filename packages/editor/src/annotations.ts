import * as Y from "yjs";

export type MarkdownAnchor = {
  start: number[];
  end: number[];
  quote: string;
  generation: number;
};
export type SourceAnnotation = { id: string; from: number; to: number };
/** Existing comment payload, unchanged. Collapsed/deleted/generation-mismatched
 * anchors are unresolved; no fuzzy matching to unrelated text or thread deletion. */
export function resolveAnchor(
  doc: Y.Doc,
  generation: number,
  anchor: MarkdownAnchor,
): { from: number; to: number } | null {
  if (anchor.generation !== generation) return null;
  const bytes = (value: number[]) =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 1024 &&
    value.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
  if (!bytes(anchor.start) || !bytes(anchor.end)) return null;
  try {
    const text = doc.getText("markdown");
    const a = Y.createAbsolutePositionFromRelativePosition(
      Y.decodeRelativePosition(Uint8Array.from(anchor.start)),
      doc,
    );
    const b = Y.createAbsolutePositionFromRelativePosition(
      Y.decodeRelativePosition(Uint8Array.from(anchor.end)),
      doc,
    );
    return a?.type === text && b?.type === text && a.index < b.index
      ? { from: a.index, to: b.index }
      : null;
  } catch {
    return null;
  }
}
