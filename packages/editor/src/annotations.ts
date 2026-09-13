import * as Y from "yjs";

export type MarkdownAnchor = {
  start: number[];
  end: number[];
  quote: string;
  generation: number;
  kind?: "block" | "text" | "point";
  blockType?: string;
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
    return a?.type === text &&
      b?.type === text &&
      (a.index < b.index || (anchor.kind === "point" && a.index === b.index))
      ? { from: a.index, to: b.index }
      : null;
  } catch {
    return null;
  }
}

/** Captures source identity without selecting prose or publishing a cursor. */
export function createMarkAnchor(
  doc: Y.Doc,
  generation: number,
  from: number,
  to: number,
  kind: "block" | "text" | "point" = "text",
  blockType?: string,
): MarkdownAnchor | null {
  const text = doc.getText("markdown");
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < from ||
    to > text.length
  )
    return null;
  if (from === to) kind = "point";
  return {
    start: Array.from(
      Y.encodeRelativePosition(
        Y.createRelativePositionFromTypeIndex(text, from),
      ),
    ),
    end: Array.from(
      Y.encodeRelativePosition(
        Y.createRelativePositionFromTypeIndex(text, to, from === to ? 0 : -1),
      ),
    ),
    quote: text.toString().slice(from, to).slice(0, 2000),
    generation,
    kind,
    blockType,
  };
}
