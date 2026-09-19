import { tabRoute } from "@axiom/shared/application-tabs";

export const workspaceResumeKey = (account: string, id: string) =>
  `axiom:workspace-view:${account}:${id}`;

/** Only persist sanitized, in-workspace routes; never drafts or credentials. */
export function workspaceDestination(account: string, id: string) {
  try {
    const value = localStorage.getItem(workspaceResumeKey(account, id));
    if (
      value &&
      tabRoute(value) === value &&
      value.startsWith(`/workspaces/${id}/`)
    )
      return value;
  } catch {}
  return `/workspaces/${id}/overview`;
}

export function workspaceSectionDestination(
  account: string,
  id: string,
  section: string,
) {
  const base = `/workspaces/${id}/${section}`;
  try {
    const route = localStorage.getItem(
      workspaceResumeKey(account, id) + ":" + section,
    );
    if (
      route &&
      tabRoute(route) === route &&
      (route === base ||
        route.startsWith(base + "?") ||
        route.startsWith(base + "/"))
    )
      return route;
  } catch {}
  return base;
}
