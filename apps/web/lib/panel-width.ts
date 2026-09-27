export function clampPanelWidth(width: number, min: number, max: number) {
  return Math.round(Math.max(min, Math.min(max, width)));
}
export function storedPanelWidth(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
) {
  const width = value === null ? NaN : Number(value);
  return Number.isFinite(width) && width >= min && width <= max
    ? width
    : fallback;
}
