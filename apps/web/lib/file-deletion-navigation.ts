import type { FileOperation } from "@axiom/shared/file-workflows";
import type {
  Resource,
  ResourceLocation,
  Space,
} from "@axiom/shared/workspace";
import { locationResourceId } from "@axiom/shared/workspace-location";

type Item = ResourceLocation["resource"];
type Location = Pick<ResourceLocation, "resource" | "ancestors">;
type SecondaryView = { id: string; close: () => void };
type Read = <T>(path: string, options: { signal: AbortSignal }) => Promise<T>;

export function directoryRoute(spaceId: string, parentId: string | null) {
  return `/workspaces/${spaceId}/files${parentId ? `?folder=${parentId}` : ""}`;
}

/** Find the outside of the entire successfully deleted subtree, not just the file. */
export function deletionParent(location: Location, deleted: Set<string>) {
  const chain = [...location.ancestors, location.resource];
  const first = chain.findIndex((item) => deleted.has(item.id));
  if (first < 0) return null;
  const parents = chain
    .slice(0, first)
    .map((item) => item.id)
    .reverse();
  // A directly selected file still has a useful parent if its location read failed.
  if (
    !location.ancestors.length &&
    location.resource.parent_id &&
    !deleted.has(location.resource.parent_id)
  )
    parents.push(location.resource.parent_id);
  return { spaceId: location.resource.space_id, parents };
}

/** Quiet, scoped observation. A queued acknowledgement is not a successful mutation. */
export async function observeFileOperation(
  initial: FileOperation,
  read: (
    path: string,
    options: { signal: AbortSignal },
  ) => Promise<FileOperation>,
  signal: AbortSignal,
  completed: (ids: string[]) => Promise<void> | void,
) {
  const seen = new Set<string>();
  let operation = initial;
  while (!signal.aborted) {
    const ids = operation.results
      .filter((r) => r.ok && !seen.has(r.id))
      .map((r) => r.id);
    ids.forEach((id) => seen.add(id));
    if (ids.length) await completed(ids);
    if (signal.aborted || ["completed", "cancelled"].includes(operation.status))
      return;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, 1000);
      signal.addEventListener("abort", done, { once: true });
      if (signal.aborted) done();
    });
    if (signal.aborted) return;
    try {
      const next = await read(`file-operations/${initial.id}`, {
        signal,
      });
      if (signal.aborted) return;
      operation = next;
    } catch (error) {
      if (signal.aborted || unavailable(error)) return;
      // Network, rate-limit and server errors are not deletion receipts.
    }
  }
}

function unavailable(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    "status" in error &&
    [401, 403, 404, 410].includes(Number(error.status))
  );
}

/** Account-scoped lifetime and navigation tickets; no document content is retained. */
export class FileDeletionNavigation {
  private controller = new AbortController();
  private epoch = 0;
  private secondary: SecondaryView | null = null;
  constructor(
    private readonly host: {
      read: Read;
      route: () => string;
      navigate: (destination: string, current: () => boolean) => void;
      close: (view: SecondaryView, current: () => boolean) => void;
    },
  ) {}

  get signal() {
    return this.controller.signal;
  }

  listen(events: EventTarget) {
    // React's development effect replay must invalidate old work, not revive it.
    this.controller.abort();
    this.controller = new AbortController();
    this.epoch++;
    let route = this.host.route();
    const changed = (event: Event) => {
      const next = this.host.route();
      if (route !== next || event.type === "popstate") this.epoch++;
      route = next;
    };
    const close = () => {
      this.controller.abort();
      this.epoch++;
    };
    for (const event of ["axiom:route", "popstate", "hashchange"])
      events.addEventListener(event, changed);
    events.addEventListener("axiom:close-documents", close);
    return () => {
      close();
      for (const event of ["axiom:route", "popstate", "hashchange"])
        events.removeEventListener(event, changed);
      events.removeEventListener("axiom:close-documents", close);
    };
  }

  registerSecondary = (view: SecondaryView) => {
    this.secondary = view;
    return () => {
      if (this.secondary === view) this.secondary = null;
    };
  };

  async prepare(items: Item[]) {
    const signal = this.signal,
      epoch = this.epoch,
      route = this.host.route(),
      secondary = this.secondary;
    const current = () =>
      !signal.aborted && epoch === this.epoch && route === this.host.route();
    const locate = async (id: string | null): Promise<Location | null> => {
      if (!id || !items.length) return null;
      try {
        const location = await this.host.read<ResourceLocation>(
          `resources/${id}/location`,
          { signal },
        );
        return location.resource.id === id ? location : null;
      } catch {
        const resource = items.find((item) => item.id === id);
        return resource ? { resource, ancestors: [] } : null;
      }
    };
    const [primaryLocation, secondaryLocation] = await Promise.all([
      locate(locationResourceId(route.replace(/^\/workbench(?=\/|$)/, ""))),
      locate(secondary?.id ?? null),
    ]);
    const deleted = new Set<string>();
    let handledPrimary = false,
      handledSecondary = false;
    return async (ids: string[]) => {
      ids.forEach((id) => deleted.add(id));
      if (!current()) return;
      const parent =
        primaryLocation && deletionParent(primaryLocation, deleted);
      if (parent && !handledPrimary) {
        handledPrimary = true;
        const destination = await this.destination(parent, signal);
        if (current()) this.host.navigate(destination, current);
        return;
      }
      if (
        !handledSecondary &&
        secondary &&
        this.secondary === secondary &&
        secondaryLocation &&
        deletionParent(secondaryLocation, deleted)
      ) {
        handledSecondary = true;
        this.host.close(
          secondary,
          () => current() && this.secondary === secondary,
        );
      }
    };
  }

  private async destination(
    parent: NonNullable<ReturnType<typeof deletionParent>>,
    signal: AbortSignal,
  ) {
    for (const id of parent.parents) {
      try {
        const resource = await this.host.read<Resource>(`resources/${id}`, {
          signal,
        });
        if (!resource.deleted_at)
          return directoryRoute(resource.space_id, resource.id);
      } catch (error) {
        if (!unavailable(error)) return directoryRoute(parent.spaceId, id);
      }
    }
    try {
      const spaces = await this.host.read<Space[]>("spaces", { signal });
      if (
        !spaces.some(
          (space) =>
            space.id === parent.spaceId &&
            !["trashed", "purging"].includes(space.effective_status),
        )
      )
        return "/workspaces";
    } catch (error) {
      if (unavailable(error)) return "/workspaces";
    }
    return directoryRoute(parent.spaceId, null);
  }
}
