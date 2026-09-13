/** Lossless, bounded sequence diff. Offsets are UTF-16, as in the source engine. */
export type DiffKind = "equal" | "add" | "remove";
export type DiffSpan = {
  kind: DiffKind;
  text: string;
  oldFrom: number;
  newFrom: number;
};
export type VersionDiff = { spans: DiffSpan[]; coarse: boolean };
type Step = { kind: DiffKind; text: string };
const lines = (s: string) => s.match(/[^\n]*\n|[^\n]+$/g) ?? [];
const words = (s: string) => s.match(/\s+|[\p{L}\p{N}\p{M}_]+|[^\s]/gu) ?? [];

function sequence(
  a: string[],
  b: string[],
  budget: number,
): { steps: Step[]; coarse: boolean } {
  let prefix = 0,
    suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix])
    prefix++;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - suffix - 1] === b[b.length - suffix - 1]
  )
    suffix++;
  const left = a.slice(prefix, a.length - suffix),
    right = b.slice(prefix, b.length - suffix);
  const wrap = (middle: Step[], coarse = false) => ({
    steps: [
      ...a.slice(0, prefix).map((text) => ({ kind: "equal" as const, text })),
      ...middle,
      ...a
        .slice(a.length - suffix)
        .map((text) => ({ kind: "equal" as const, text })),
    ],
    coarse,
  });
  if (!left.length || !right.length)
    return wrap([
      ...left.map((text) => ({ kind: "remove" as const, text })),
      ...right.map((text) => ({ kind: "add" as const, text })),
    ]);
  const v = new Map<number, number>([[1, 0]]),
    trace: Map<number, number>[] = [];
  let spent = 0;
  for (let d = 0; d <= Math.min(left.length + right.length, 512); d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      if (++spent > budget) break;
      let x =
        k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1))
          ? (v.get(k + 1) ?? 0)
          : (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < left.length && y < right.length && left[x] === right[y]) {
        x++;
        y++;
        if (++spent > budget) break;
      }
      v.set(k, x);
      if (x >= left.length && y >= right.length) {
        const result: Step[] = [];
        for (let depth = d; depth >= 0; depth--) {
          const old = trace[depth],
            diagonal = x - y;
          const previous =
            diagonal === -depth ||
            (diagonal !== depth &&
              (old.get(diagonal - 1) ?? -1) < (old.get(diagonal + 1) ?? -1))
              ? diagonal + 1
              : diagonal - 1;
          const px = old.get(previous) ?? 0,
            py = px - previous;
          while (x > px && y > py) {
            result.push({ kind: "equal", text: left[--x] });
            y--;
          }
          if (!depth) break;
          if (x === px) result.push({ kind: "add", text: right[--y] });
          else result.push({ kind: "remove", text: left[--x] });
        }
        return wrap(result.reverse());
      }
    }
    if (spent > budget) break;
  }
  return wrap(
    [
      ...left.map((text) => ({ kind: "remove" as const, text })),
      ...right.map((text) => ({ kind: "add" as const, text })),
    ],
    true,
  );
}
export function versionDiff(
  before: string,
  after: string,
  refine = true,
): VersionDiff {
  if (before.length > 1_000_000 || after.length > 1_000_000)
    throw new Error(
      "Comparison is limited to one million characters per revision.",
    );
  const result = sequence(lines(before), lines(after), 500_000),
    steps: Step[] = [];
  for (let i = 0; i < result.steps.length;) {
    if (result.steps[i].kind === "equal") {
      steps.push(result.steps[i++]);
      continue;
    }
    let old = "",
      next = "";
    const group: Step[] = [];
    while (i < result.steps.length && result.steps[i].kind !== "equal") {
      const part = result.steps[i++];
      group.push(part);
      if (part.kind === "remove") old += part.text;
      else next += part.text;
    }
    if (refine && old && next && old.length + next.length <= 20_000) {
      const detail = sequence(words(old), words(next), 40_000);
      steps.push(...detail.steps);
      result.coarse ||= detail.coarse;
    } else steps.push(...group);
  }
  const spans: DiffSpan[] = [];
  let oldFrom = 0,
    newFrom = 0;
  for (const step of steps) {
    const last = spans.at(-1);
    if (last?.kind === step.kind) last.text += step.text;
    else spans.push({ ...step, oldFrom, newFrom });
    if (step.kind !== "add") oldFrom += step.text.length;
    if (step.kind !== "remove") newFrom += step.text.length;
  }
  return { spans, coarse: result.coarse };
}
export function diffChanges(before: string, after: string) {
  const changes: { from: number; to: number; insert: string }[] = [];
  for (const s of versionDiff(before, after).spans) {
    if (s.kind === "equal") continue;
    const from = s.oldFrom,
      to = from + (s.kind === "remove" ? s.text.length : 0);
    const previous = changes.at(-1);
    if (previous && previous.to === from) {
      previous.to = to;
      if (s.kind === "add") previous.insert += s.text;
    } else changes.push({ from, to, insert: s.kind === "add" ? s.text : "" });
  }
  return changes;
}
