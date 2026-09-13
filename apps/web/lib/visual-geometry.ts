import { clampUnit, type VisualPoint } from "@axiom/shared/visual-annotations";
export type VisualTransform = {
  zoom: number;
  x: number;
  y: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
};
export const initialVisualTransform = (): VisualTransform => ({
  zoom: 1,
  x: 0,
  y: 0,
  rotation: 0,
  flipX: false,
  flipY: false,
});
/** Bounded freehand sampling retains both the initial point and newest edge. */
export function appendVisualPoint(
  points: VisualPoint[],
  next: VisualPoint,
): VisualPoint[] {
  const sampled =
    points.length >= 2000 ? points.filter((_, i) => i % 2 === 0) : points;
  return [...sampled, next];
}
export const zoomLimit = (n: number) =>
  Math.max(0.01, Math.min(32, Number.isFinite(n) ? n : 1));
export function rotatedSize(width: number, height: number, rotation: number) {
  return Math.abs(rotation % 180) === 90
    ? { width: height, height: width }
    : { width, height };
}
export function fitVisual(
  width: number,
  height: number,
  stageWidth: number,
  stageHeight: number,
  rotation = 0,
  fitWidth = false,
) {
  const size = rotatedSize(width, height, rotation);
  return zoomLimit(
    Math.min(
      (stageWidth - 48) / size.width,
      fitWidth ? Infinity : (stageHeight - 48) / size.height,
      fitWidth ? Infinity : 1,
    ),
  );
}
/** Forward/inverse transforms are shared by pan/zoom, sampling and markup. */
export function visualToScreen(
  point: VisualPoint,
  width: number,
  height: number,
  t: VisualTransform,
): VisualPoint {
  const x = (point[0] - 0.5) * width * (t.flipX ? -1 : 1),
    y = (point[1] - 0.5) * height * (t.flipY ? -1 : 1),
    a = (t.rotation * Math.PI) / 180;
  return [
    (x * Math.cos(a) - y * Math.sin(a)) * t.zoom + t.x,
    (x * Math.sin(a) + y * Math.cos(a)) * t.zoom + t.y,
  ];
}
export function screenToVisual(
  point: VisualPoint,
  width: number,
  height: number,
  t: VisualTransform,
  clamp = true,
): VisualPoint {
  const x = (point[0] - t.x) / t.zoom,
    y = (point[1] - t.y) / t.zoom,
    a = (-t.rotation * Math.PI) / 180;
  const px =
      ((x * Math.cos(a) - y * Math.sin(a)) * (t.flipX ? -1 : 1)) / width + 0.5,
    py =
      ((x * Math.sin(a) + y * Math.cos(a)) * (t.flipY ? -1 : 1)) / height + 0.5;
  return clamp ? [clampUnit(px), clampUnit(py)] : [px, py];
}
export function zoomVisual(
  t: VisualTransform,
  zoom: number,
  pointer: VisualPoint = [0, 0],
): VisualTransform {
  const next = zoomLimit(zoom),
    ratio = next / t.zoom;
  return {
    ...t,
    zoom: next,
    x: pointer[0] - (pointer[0] - t.x) * ratio,
    y: pointer[1] - (pointer[1] - t.y) * ratio,
  };
}
