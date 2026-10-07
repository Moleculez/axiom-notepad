/** Ordinary document reading retains native non-heading anchors. Embedded
 * readers may opt in to their host's internal navigation instead. */
export function readingLinkRoute(
  target: string,
  outline: readonly { id: string }[],
  interceptInternalAnchors = false,
): "internal" | "link" | "native" {
  if (!target.startsWith("#")) return "link";
  if (interceptInternalAnchors) return "internal";
  return outline.some((heading) => "#" + heading.id === target)
    ? "link"
    : "native";
}
