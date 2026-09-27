import { afterEach, expect, test, vi } from "vitest";
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../apps/web/lib/client", () => ({ api }));
import {
  clearSharedRequests,
  sharedRequest,
} from "../apps/web/lib/shared-request";
import { workspaceActivity } from "../apps/web/lib/workspace-activity";

afterEach(() => {
  clearSharedRequests();
  api.mockReset();
  workspaceActivity.reset();
  vi.useRealTimers();
});

test("slow background refreshes never show global progress", async () => {
  vi.useFakeTimers();
  api.mockReturnValue(new Promise(() => {}));
  const request = sharedRequest("alice", "spaces", 1, 0, false);
  vi.advanceTimersByTime(30000);
  expect(workspaceActivity.getSnapshot()).toBe("idle");
  request.release();
  await Promise.resolve();
  expect(workspaceActivity.getSnapshot()).toBe("idle");
});

test("foreground navigation can join a background request without inheriting its lifetime", async () => {
  vi.useFakeTimers();
  api.mockReturnValue(new Promise(() => {}));
  const poll = sharedRequest("alice", "spaces", 0, 0, false);
  const navigation = sharedRequest("alice", "spaces");
  expect(poll.promise).toBe(navigation.promise);
  vi.advanceTimersByTime(500);
  expect(workspaceActivity.getSnapshot()).toBe("loading");
  navigation.release();
  vi.advanceTimersByTime(1000);
  expect(workspaceActivity.getSnapshot()).toBe("idle");
  expect(api.mock.calls[0][1].signal.aborted).toBe(false);
  poll.release();
  await Promise.resolve();
  expect(api.mock.calls[0][1].signal.aborted).toBe(true);
});

test("concurrent readers share a request without aborting another reader", async () => {
  api.mockReturnValue(new Promise(() => {}));
  const a = sharedRequest("alice", "spaces"),
    b = sharedRequest("alice", "spaces");
  expect(api).toHaveBeenCalledTimes(1);
  expect(a.promise).toBe(b.promise);
  const signal = api.mock.calls[0][1].signal as AbortSignal;
  a.release();
  a.release();
  await Promise.resolve();
  expect(signal.aborted).toBe(false);
  b.release();
  await Promise.resolve();
  expect(signal.aborted).toBe(true);
});

test("a same-tick remount retains its request; account and revision never share permissions", async () => {
  api.mockReturnValue(new Promise(() => {}));
  const a = sharedRequest("alice", "spaces");
  a.release();
  const remount = sharedRequest("alice", "spaces");
  await Promise.resolve();
  expect(a.promise).toBe(remount.promise);
  expect(api.mock.calls[0][1].signal.aborted).toBe(false);
  sharedRequest("bob", "spaces");
  sharedRequest("alice", "spaces", 1);
  expect(api).toHaveBeenCalledTimes(3);
  clearSharedRequests();
  expect(api.mock.calls.every((call) => call[1].signal.aborted)).toBe(true);
});

test("settled responses are not retained as an authorization cache", async () => {
  api.mockResolvedValue({ name: "private" });
  const request = sharedRequest("alice", "resource");
  await expect(request.promise).resolves.toEqual({ name: "private" });
  request.release();
  await sharedRequest("alice", "resource").promise;
  expect(api).toHaveBeenCalledTimes(2);
});
