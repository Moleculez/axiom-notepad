import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileOperation } from "@axiom/shared/file-workflows";
import type { ResourceLocation } from "@axiom/shared/workspace";
import {
  deletionParent,
  directoryRoute,
  FileDeletionNavigation,
  observeFileOperation,
} from "../apps/web/lib/file-deletion-navigation";

const space = "00000000-0000-4000-8000-000000000001";
const outer = "00000000-0000-4000-8000-000000000002";
const inner = "00000000-0000-4000-8000-000000000003";
const file = "00000000-0000-4000-8000-000000000004";
const other = "00000000-0000-4000-8000-000000000005";
const item = (id: string, parent_id: string | null = null) => ({
  id,
  parent_id,
  space_id: space,
  name: id,
  kind: "note" as const,
});
const location: ResourceLocation = {
  resource: item(file, inner),
  space: { id: space, name: "Research", kind: "team" },
  ancestors: [outer, inner].map((id) => ({ id, name: id, kind: "folder" })),
};
function harness(route = `/workbench/notes/${file}`) {
  const events = new EventTarget();
  const read = vi.fn(async (path: string): Promise<any> => {
    if (path === "spaces") return [{ id: space, effective_status: "active" }];
    if (path === `resources/${file}/location`) return location;
    if (path === `resources/${other}/location`)
      return { ...location, resource: item(other, inner) };
    return { ...item(path.split("/")[1]), deleted_at: null };
  });
  const navigate = vi.fn(),
    close = vi.fn();
  const manager = new FileDeletionNavigation({
    read,
    route: () => route,
    navigate,
    close,
  });
  const dispose = manager.listen(events);
  return {
    manager,
    read,
    navigate,
    close,
    events,
    dispose,
    visit: (next: string) => {
      route = next;
      events.dispatchEvent(new Event("axiom:route"));
    },
  };
}
afterEach(() => vi.useRealTimers());

describe("deletion destinations", () => {
  it("resolves nested, root and successfully deleted ancestor boundaries", () => {
    expect(deletionParent(location, new Set([file]))).toEqual({
      spaceId: space,
      parents: [inner, outer],
    });
    expect(deletionParent(location, new Set([file, inner]))).toEqual({
      spaceId: space,
      parents: [outer],
    });
    expect(deletionParent(location, new Set([outer]))).toEqual({
      spaceId: space,
      parents: [],
    });
    expect(deletionParent(location, new Set([other]))).toBeNull();
    expect(directoryRoute(space, null)).toBe(`/workspaces/${space}/files`);
  });

  it.each([
    "notes",
    "canvas",
    "image",
    "math",
    "text",
    "pdf",
    "audio",
    "video",
    "document",
    "files",
  ])(
    "returns %s files to the containing directory only after success",
    async (kind) => {
      const h = harness(`/workbench/${kind}/${file}`);
      const finish = await h.manager.prepare([location.resource]);
      expect(h.navigate).not.toHaveBeenCalled();
      await finish([]);
      await finish([other]);
      expect(h.navigate).not.toHaveBeenCalled();
      await finish([file]);
      expect(h.navigate).toHaveBeenCalledWith(
        directoryRoute(space, inner),
        expect.any(Function),
      );
      await finish([file]);
      expect(h.navigate).toHaveBeenCalledTimes(1);
      h.dispose();
    },
  );

  it.each([
    "/workbench/home",
    "/workbench/explorer?view=recent",
    `/workbench/explorer?space=${space}`,
    `/workbench/workspaces/${space}/files`,
    "/workbench/search",
  ])("does not leave unaffected listing %s", async (route) => {
    const h = harness(route);
    await (
      await h.manager.prepare([location.resource])
    )([file]);
    expect(h.navigate).not.toHaveBeenCalled();
    h.dispose();
  });

  it("leaves a deleted ancestor, including an open folder route", async () => {
    for (const route of [
      `/workbench/notes/${file}`,
      `/workbench/workspaces/${space}/files?folder=${inner}`,
      `/workbench/explorer?space=${space}&folder=${inner}`,
    ]) {
      const h = harness(route);
      h.read.mockImplementation(async (path) =>
        path.endsWith("/location")
          ? {
              ...location,
              ...(route.includes("folder=")
                ? {
                    resource: item(inner, outer),
                    ancestors: [location.ancestors[0]],
                  }
                : {}),
            }
          : item(outer),
      );
      await (
        await h.manager.prepare([item(inner, outer)])
      )([inner]);
      expect(h.navigate).toHaveBeenCalledWith(
        directoryRoute(space, outer),
        expect.any(Function),
      );
      h.dispose();
    }
  });

  it("uses the captured parent if an offline or failed location read cannot provide ancestry", async () => {
    const h = harness();
    h.read.mockRejectedValue(new TypeError("Offline"));
    await (
      await h.manager.prepare([location.resource])
    )([file]);
    expect(h.navigate).toHaveBeenCalledWith(
      directoryRoute(space, inner),
      expect.any(Function),
    );
    h.dispose();
  });

  it("skips authoritatively missing/deleted parents but not transient failures", async () => {
    for (const missing of ["deleted", 404, 403, 503, 429]) {
      const h = harness();
      const finish = await h.manager.prepare([location.resource]);
      h.read.mockImplementation(async (path) => {
        if (path === `resources/${inner}`) {
          if (missing === "deleted")
            return { ...item(inner), deleted_at: "today" };
          throw { status: missing };
        }
        return item(outer);
      });
      await finish([file]);
      expect(h.navigate.mock.calls[0][0]).toBe(
        directoryRoute(
          space,
          [503, 429].includes(Number(missing)) ? inner : outer,
        ),
      );
      h.dispose();
    }
  });

  it("falls back to the workspace root or workspace list if its access is gone", async () => {
    for (const spaces of [[{ id: space, effective_status: "active" }], []]) {
      const h = harness();
      const finish = await h.manager.prepare([item(outer)]);
      h.read.mockResolvedValue(spaces);
      await finish([outer]);
      expect(h.navigate.mock.calls[0][0]).toBe(
        spaces.length ? directoryRoute(space, null) : "/workspaces",
      );
      h.dispose();
    }
  });

  it("does not steal navigation even after visiting elsewhere and returning to the same URL", async () => {
    const h = harness(),
      finish = await h.manager.prepare([location.resource]);
    h.visit("/workbench/home");
    h.visit(`/workbench/notes/${file}`);
    await finish([file]);
    expect(h.navigate).not.toHaveBeenCalled();
    h.dispose();
  });

  it("rechecks navigation after an asynchronous parent lookup and before a deferred draft-guard approval", async () => {
    const h = harness(),
      finish = await h.manager.prepare([location.resource]);
    await finish([file]);
    const stillCurrent = h.navigate.mock.calls[0][1];
    expect(stillCurrent()).toBe(true);
    h.visit("/workbench/home");
    expect(stillCurrent()).toBe(false);
    h.dispose();

    const next = harness(),
      complete = await next.manager.prepare([location.resource]);
    next.read.mockImplementation(async () => {
      next.visit("/workbench/home");
      return item(inner);
    });
    await complete([file]);
    expect(next.navigate).not.toHaveBeenCalled();
    next.dispose();
  });

  it("account close and effect replay invalidate old callbacks and pending requests", async () => {
    const h = harness(),
      finish = await h.manager.prepare([location.resource]);
    const signal = h.manager.signal;
    h.events.dispatchEvent(new Event("axiom:close-documents"));
    expect(signal.aborted).toBe(true);
    h.dispose();
    const dispose = h.manager.listen(h.events);
    await finish([file]);
    expect(h.navigate).not.toHaveBeenCalled();
    dispose();
  });

  it("closes only a deleted secondary pane and ignores a replaced registration", async () => {
    for (const replace of [false, true]) {
      const h = harness();
      const secondary = { id: other, close: vi.fn() };
      h.manager.registerSecondary(secondary);
      const finish = await h.manager.prepare([item(other, inner)]);
      if (replace) h.manager.registerSecondary({ id: other, close: vi.fn() });
      await finish([other]);
      expect(h.navigate).not.toHaveBeenCalled();
      expect(h.close).toHaveBeenCalledTimes(replace ? 0 : 1);
      if (!replace)
        expect(h.close).toHaveBeenCalledWith(secondary, expect.any(Function));
      h.dispose();
    }
  });
});

describe("file operation receipts", () => {
  const operation = (
    status: FileOperation["status"],
    results: FileOperation["results"] = [],
  ): FileOperation => ({
    id: "job",
    command: "trash",
    status,
    results,
    input: { id: "job", command: "trash", items: [], confirmAudience: false },
    updated_at: "now",
  });
  it.each(["completed", "cancelled"] as const)(
    "processes only successful results of a %s operation",
    async (status) => {
      const read = vi.fn(),
        completed = vi.fn(),
        controller = new AbortController();
      await observeFileOperation(
        operation(status, [
          { id: file, ok: false },
          { id: other, ok: true },
        ]),
        read,
        controller.signal,
        completed,
      );
      expect(completed).toHaveBeenCalledExactlyOnceWith([other]);
      expect(read).not.toHaveBeenCalled();
    },
  );
  it("waits for per-item success, deduplicates receipts, tolerates transient errors and stops at completion", async () => {
    vi.useFakeTimers();
    const controller = new AbortController(),
      completed = vi.fn();
    const read = vi
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce(operation("running", [{ id: other, ok: false }]))
      .mockResolvedValueOnce(
        operation("running", [
          { id: other, ok: false },
          { id: file, ok: true },
        ]),
      )
      .mockResolvedValueOnce(
        operation("completed", [
          { id: other, ok: false },
          { id: file, ok: true },
        ]),
      );
    const observing = observeFileOperation(
      operation("queued"),
      read,
      controller.signal,
      completed,
    );
    expect(completed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(completed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    await observing;
    expect(completed).toHaveBeenCalledExactlyOnceWith([file]);
    expect(read).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("stops timers on abort and does not emit a late response after sign-out", async () => {
    vi.useFakeTimers();
    const controller = new AbortController(),
      completed = vi.fn();
    const read = vi.fn(async () => {
      controller.abort();
      return operation("completed", [{ id: file, ok: true }]);
    });
    const observing = observeFileOperation(
      operation("queued"),
      read,
      controller.signal,
      completed,
    );
    await vi.advanceTimersByTimeAsync(1000);
    await observing;
    expect(completed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    const stopped = new AbortController();
    const waiting = observeFileOperation(
      operation("queued"),
      read,
      stopped.signal,
      completed,
    );
    stopped.abort();
    await waiting;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not invent completion when operation access is lost", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockRejectedValue({ status: 404 }),
      completed = vi.fn();
    const observing = observeFileOperation(
      operation("queued"),
      read,
      new AbortController().signal,
      completed,
    );
    await vi.advanceTimersByTimeAsync(1000);
    await observing;
    expect(completed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
