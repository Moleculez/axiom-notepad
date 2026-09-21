import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createWorkspaceActivity } from "../apps/web/lib/workspace-activity";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("quick requests never flash a loading bar", () => {
  const store = createWorkspaceActivity(),
    listener = vi.fn();
  store.subscribe(listener);
  const finish = store.begin();
  vi.advanceTimersByTime(100);
  finish();
  vi.runAllTimers();
  expect(store.getSnapshot()).toBe("idle");
  expect(listener).not.toHaveBeenCalled();
});
test("slow requests reveal, hold briefly, finish and then hide", () => {
  const store = createWorkspaceActivity(),
    finish = store.begin();
  vi.advanceTimersByTime(159);
  expect(store.getSnapshot()).toBe("idle");
  vi.advanceTimersByTime(1);
  expect(store.getSnapshot()).toBe("loading");
  finish();
  vi.advanceTimersByTime(259);
  expect(store.getSnapshot()).toBe("loading");
  vi.advanceTimersByTime(1);
  expect(store.getSnapshot()).toBe("complete");
  vi.advanceTimersByTime(180);
  expect(store.getSnapshot()).toBe("idle");
});
test("concurrent work waits for the last request and finishes only once", () => {
  const store = createWorkspaceActivity(),
    a = store.begin(),
    b = store.begin();
  vi.advanceTimersByTime(500);
  a();
  a();
  vi.advanceTimersByTime(500);
  expect(store.getSnapshot()).toBe("loading");
  b();
  vi.runAllTimers();
  expect(store.getSnapshot()).toBe("idle");
});
test.each(["settling", "complete"])(
  "new work cancels the %s transition",
  (state) => {
    const store = createWorkspaceActivity(),
      a = store.begin();
    vi.advanceTimersByTime(170);
    a();
    if (state === "complete") vi.advanceTimersByTime(260);
    const b = store.begin();
    vi.advanceTimersByTime(600);
    expect(store.getSnapshot()).toBe("loading");
    b();
    vi.runAllTimers();
    expect(store.getSnapshot()).toBe("idle");
  },
);
test("reset discards old completions without affecting a new account's work", () => {
  const store = createWorkspaceActivity(),
    old = store.begin();
  vi.advanceTimersByTime(200);
  store.reset();
  expect(store.getSnapshot()).toBe("idle");
  const current = store.begin();
  old();
  vi.advanceTimersByTime(1000);
  expect(store.getSnapshot()).toBe("loading");
  current();
  vi.runAllTimers();
  expect(store.getSnapshot()).toBe("idle");
});
test("reset before reveal clears timers and subscribers can detach", () => {
  const store = createWorkspaceActivity(),
    listener = vi.fn();
  const off = store.subscribe(listener);
  store.begin();
  store.reset();
  vi.runAllTimers();
  expect(listener).not.toHaveBeenCalled();
  off();
  const finish = store.begin();
  vi.advanceTimersByTime(160);
  finish();
  vi.runAllTimers();
  expect(listener).not.toHaveBeenCalled();
});
