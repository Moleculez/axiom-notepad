import { tabRoute, tabTitle } from "./application-tabs";
import { fileRouteId, isFileView } from "./file-routes";
import type { ResourceLocation, Space } from "./workspace";

export type LocationCrumb = { label: string; to?: string };
export function folderRoute(spaceId: string, folderId?: string | null) {
  const params = new URLSearchParams({ space: spaceId });
  if (folderId) params.set("folder", folderId);
  return `/explorer?${params}`;
}
/** Notes, uploaded files and studio projects share the same resource hierarchy. */
export function locationResourceId(route: string) {
  const url = new URL(route, "http://workspace.local"),
    parts = url.pathname.split("/").filter(Boolean);
  const id =
    fileRouteId(route) ??
    (parts[0] === "explorer" ? url.searchParams.get("folder") : null);
  return id && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)
    ? id
    : null;
}

export function workspaceLocation({
  route,
  title,
  location,
  space,
}: {
  route: string;
  title?: string;
  location?: ResourceLocation | null;
  space?: Pick<Space, "id" | "name">;
}): { crumbs: LocationCrumb[]; up: string | null } {
  const url = new URL(route, "http://workspace.local"),
    parts = url.pathname.split("/").filter(Boolean),
    section = parts[0] || "home";
  const root =
    section === "admin"
      ? "/groups"
      : section === "explorer" || isFileView(section) || section === "tools"
        ? "/explorer?view=all"
        : tabRoute(`/${section}`);
  const first: LocationCrumb = { label: tabTitle(root), to: root };
  if (location && location.resource.id === locationResourceId(route)) {
    return {
      crumbs: [
        first,
        { label: location.space.name, to: folderRoute(location.space.id) },
        ...location.ancestors.map((item) => ({
          label: item.name,
          to: folderRoute(location.space.id, item.id),
        })),
        { label: location.resource.name },
      ],
      up: folderRoute(location.space.id, location.resource.parent_id),
    };
  }
  if (locationResourceId(route))
    return { crumbs: [first, { label: title || tabTitle(route) }], up: root };
  if (section === "explorer") {
    const view = url.searchParams.get("view") || "folder";
    const crumbs = [first];
    if (space) crumbs.push({ label: space.name, to: folderRoute(space.id) });
    if (view !== "folder" && tabTitle(route) !== "Explorer")
      crumbs.push({ label: tabTitle(route) });
    delete crumbs.at(-1)!.to;
    return { crumbs, up: crumbs.length > 1 ? root : null };
  }
  if (parts.length > 1) {
    const child =
      section === "tools"
        ? tabTitle(route)
        : title || parts.at(-1)!.replace(/[-_]/g, " ");
    return { crumbs: [first, { label: child }], up: root };
  }
  return { crumbs: [{ label: first.label }], up: null };
}
