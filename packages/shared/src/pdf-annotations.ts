import { annotationDataSchema, type AnnotationData } from "./research";
import type { PdfPageChoice } from "./pdf-reader";

/** Rotation changes /Rotate, not the underlying PDF coordinates. */
export function mapPdfAnnotation(
  data: AnnotationData,
  pages: PdfPageChoice[],
  sha256: string,
) {
  const original = annotationSegments(data);
  const segments = pages.flatMap((page, index) => {
    const segment =
      page.source === 0 && original.find((s) => s.page === page.page);
    return segment ? [{ ...segment, page: index + 1 }] : [];
  });
  const omitted = original.filter(
    (s) => !pages.some((p) => p.source === 0 && p.page === s.page),
  ).length;
  if (!segments.length) return { data: [] as AnnotationData[], omitted };
  if (["note", "ink", "arrow", "textbox"].includes(data.kind))
    return {
      data: segments.map((segment) =>
        annotationDataSchema.parse({
          ...data,
          ...segment,
          segments: undefined,
          sha256,
        }),
      ),
      omitted,
    };
  const outputs: AnnotationData[] = [];
  let chunk: typeof segments = [];
  const flush = () => {
    if (chunk.length)
      outputs.push(
        annotationDataSchema.parse({
          ...data,
          ...chunk[0],
          segments: chunk.length > 1 ? chunk : undefined,
          sha256,
        }),
      );
    chunk = [];
  };
  for (const segment of segments) {
    if (
      chunk.length === 20 ||
      chunk.reduce((n, s) => n + s.rects.length, 0) + segment.rects.length > 200
    )
      flush();
    chunk.push(segment);
  }
  flush();
  return { data: outputs, omitted };
}

export function annotationSegments(data: AnnotationData) {
  return data.segments?.length
    ? data.segments
    : [{ page: data.page, rects: data.rects }];
}

/** Convert supported native annotations into private import candidates, never actions. */
export function importPdfAnnotation(
  raw: Record<string, unknown>,
  page: number,
  box: number[],
  sha256: string,
): AnnotationData | null {
  const kinds = {
    Highlight: "highlight",
    Underline: "underline",
    StrikeOut: "strikeout",
    Square: "area",
    Text: "note",
    FreeText: "textbox",
    Ink: "ink",
  } as const;
  const kind = kinds[raw.subtype as keyof typeof kinds];
  if (!kind || box.length !== 4) return null;
  const [x, y, right, top] = box,
    width = right - x,
    height = top - y;
  if (!(width > 0 && height > 0)) return null;
  const rect = (r: number[]) => {
    const left = Math.max(0, Math.min(1, (Math.min(r[0], r[2]) - x) / width));
    const bottom = Math.max(
      0,
      Math.min(1, (Math.min(r[1], r[3]) - y) / height),
    );
    return [
      left,
      bottom,
      Math.max(
        0,
        Math.min(1 - left, (Math.max(r[0], r[2]) - x) / width - left),
      ),
      Math.max(
        0,
        Math.min(1 - bottom, (Math.max(r[1], r[3]) - y) / height - bottom),
      ),
    ];
  };
  const quad =
    raw.quadPoints instanceof Float32Array || Array.isArray(raw.quadPoints)
      ? Array.from(raw.quadPoints as ArrayLike<number>)
      : [];
  const rects: number[][] = [];
  if (quad.length && quad.length % 8 === 0 && quad.every(Number.isFinite)) {
    for (let i = 0; i < Math.min(quad.length, 1600); i += 8) {
      const q = quad.slice(i, i + 8),
        xs = q.filter((_, j) => j % 2 === 0),
        ys = q.filter((_, j) => j % 2 === 1);
      rects.push(
        rect([
          Math.min(...xs),
          Math.min(...ys),
          Math.max(...xs),
          Math.max(...ys),
        ]),
      );
    }
  } else if (
    Array.isArray(raw.rect) &&
    raw.rect.length === 4 &&
    raw.rect.every(Number.isFinite)
  )
    rects.push(rect(raw.rect));
  const text = (value: unknown) =>
    typeof value === "object" &&
    value &&
    "str" in value &&
    typeof value.str === "string"
      ? value.str
      : "";
  const rgb =
    raw.color instanceof Uint8ClampedArray || Array.isArray(raw.color)
      ? Array.from(raw.color as ArrayLike<number>)
      : [255, 218, 53];
  const palettes = {
    yellow: [255, 218, 53],
    green: [100, 217, 153],
    blue: [118, 184, 255],
    pink: [238, 146, 193],
  } as const;
  const color = (Object.keys(palettes) as (keyof typeof palettes)[]).sort(
    (a, b) =>
      palettes[a].reduce((n, c, i) => n + (c - rgb[i]) ** 2, 0) -
      palettes[b].reduce((n, c, i) => n + (c - rgb[i]) ** 2, 0),
  )[0];
  let paths: [number, number][][] | undefined;
  if (kind === "ink") {
    if (!Array.isArray(raw.inkLists) || raw.inkLists.length > 20) return null;
    paths = [];
    for (const values of raw.inkLists) {
      if (!(Array.isArray(values) || values instanceof Float32Array))
        return null;
      if (
        values.length < 4 ||
        values.length > 4096 ||
        values.length % 2 ||
        !Array.from(values).every(Number.isFinite)
      )
        return null;
      const points: [number, number][] = [];
      for (let i = 0; i < values.length; i += 2)
        points.push([
          Math.max(0, Math.min(1, (values[i] - x) / width)),
          Math.max(0, Math.min(1, (values[i + 1] - y) / height)),
        ]);
      paths.push(points);
    }
  }
  const parsed = annotationDataSchema.safeParse({
    kind,
    page,
    sha256,
    color,
    ...(paths ? { paths, strokeWidth: 2 } : {}),
    rects: rects.filter((r) => r[2] > 0 && r[3] > 0),
    quote: "",
    body: text(raw.contentsObj).slice(0, 12000),
    imported: {
      sourceId: `${page}:${String(raw.id ?? JSON.stringify(raw.rect)).slice(0, 270)}`,
      author: text(raw.titleObj).slice(0, 300),
    },
  });
  return parsed.success ? parsed.data : null;
}
