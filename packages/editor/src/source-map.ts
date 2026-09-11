/** Lossless UTF-16 projection map. Hidden syntax has source positions but no
 * document characters. Editable delimiters are ordinary mapped text spans. */
export type Affinity = -1 | 1;
export type SourceSpan = {
  from: number;
  to: number;
  sourceFrom: number;
  sourceTo: number;
  /** Nonlinear boundaries for entities, escapes, CRLF and container prefixes. */
  boundaries?: readonly number[];
};
export class SourceMap {
  constructor(
    readonly spans: readonly SourceSpan[],
    readonly sourceLength: number,
  ) {}
  sourceAt(position: number, affinity: Affinity = 1): number {
    const spans = this.spans;
    if (!spans.length) return 0;
    let lo = 0,
      hi = spans.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (spans[mid].to < position) lo = mid + 1;
      else hi = mid;
    }
    if (
      affinity > 0 &&
      spans[lo]?.to === position &&
      spans[lo + 1]?.from === position
    )
      lo++;
    const next = spans[lo],
      prior = spans[lo - 1];
    if (next && position >= next.from && position <= next.to) {
      const offset = position - next.from;
      return next.boundaries?.[offset] ?? next.sourceFrom + offset;
    }
    if (affinity < 0 && prior) return prior.sourceTo;
    return next?.sourceFrom ?? prior?.sourceTo ?? 0;
  }
  positionAt(source: number, affinity: Affinity = 1): number {
    const spans = this.spans;
    if (!spans.length) return 1;
    let lo = 0,
      hi = spans.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (spans[mid].sourceTo < source) lo = mid + 1;
      else hi = mid;
    }
    if (
      affinity > 0 &&
      spans[lo]?.sourceTo === source &&
      spans[lo + 1]?.sourceFrom === source
    )
      lo++;
    const next = spans[lo],
      prior = spans[lo - 1];
    if (next && source >= next.sourceFrom && source <= next.sourceTo) {
      if (!next.boundaries)
        return (
          next.from + Math.min(next.to - next.from, source - next.sourceFrom)
        );
      const offsets = next.boundaries;
      let a = 0,
        b = offsets.length - 1;
      while (a < b) {
        const mid = (a + b) >>> 1;
        if (offsets[mid] < source) a = mid + 1;
        else b = mid;
      }
      return (
        next.from +
        (offsets[a] > source && affinity < 0 ? Math.max(0, a - 1) : a)
      );
    }
    if (affinity < 0 && prior) return prior.to;
    return next?.from ?? prior?.to ?? 1;
  }
  /** A mutation must have editable endpoints; structural steps use source commands. */
  editable(position: number) {
    return this.spans.some((s) => position >= s.from && position <= s.to);
  }
}
