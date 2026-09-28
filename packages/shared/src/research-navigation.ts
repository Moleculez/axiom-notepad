export const researchViews = [
  ["overview", "Summary"],
  ["library", "Library"],
  ["queue", "Reading queue"],
  ["evidence", "Evidence"],
  ["graph", "Knowledge graph"],
] as const;

export function workspaceResearchRoute(
  spaceId: string,
  values?: URLSearchParams | Record<string, string>,
) {
  const query = new URLSearchParams(values);
  for (const key of ["space", "spaceId", "group", "groupId"]) query.delete(key);
  if (!researchViews.some(([view]) => view === query.get("view")))
    query.set("view", "overview");
  return `/workspaces/${spaceId}/research?${query}`;
}

export function researchCommandRoute(path: string, spaceId?: string) {
  const url = new URL(path, "http://workspace.local");
  if (url.pathname !== "/research") return path;
  return spaceId
    ? workspaceResearchRoute(spaceId, url.searchParams)
    : `/workspaces?research=${url.searchParams.get("view") || "overview"}`;
}
