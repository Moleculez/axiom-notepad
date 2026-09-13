import { afterEach, expect, test, vi } from "vitest";
import { SaveCoordinator } from "../apps/web/lib/save-coordinator";
afterEach(() => vi.useRealTimers());
test("an acknowledgement from an earlier connection cannot confirm a reconnect", async () => {
  let resolve!: () => void;
  const send = vi.fn(() => new Promise<void>((r) => (resolve = r))),
    saves = new SaveCoordinator(send);
  const old = saves.confirm();
  saves.reconnect();
  resolve();
  await old;
  expect(saves.dirty).toBe(true);
  const current = saves.confirm();
  resolve();
  await current;
  expect(saves.dirty).toBe(false);
  saves.destroy();
});
test("coalesces idle checks and single-flights concurrent confirmations", async () => {
  let resolve!: () => void;
  const send = vi.fn(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  const saves = new SaveCoordinator(send);
  const a = saves.confirm(),
    b = saves.confirm();
  expect(a).toBe(b);
  expect(send).toHaveBeenCalledTimes(1);
  resolve();
  await a;
  await saves.confirm();
  expect(send).toHaveBeenCalledTimes(1);
  saves.destroy();
});
test("continuous edits have a bounded deadline and clean retries make no requests", async () => {
  vi.useFakeTimers();
  const send = vi.fn(async () => {});
  const saves = new SaveCoordinator(send);
  await saves.confirm();
  for (let i = 0; i < 20; i++) {
    saves.changed();
    await vi.advanceTimersByTimeAsync(250);
  }
  expect(send).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(10_000);
  await saves.confirm();
  expect(send).toHaveBeenCalledTimes(2);
  saves.destroy();
});
test("flush cannot acknowledge an edit newer than an in-flight request", async () => {
  const resolvers: (() => void)[] = [];
  const send = vi.fn(() => new Promise<void>((r) => resolvers.push(r)));
  const saves = new SaveCoordinator(send);
  const flushed = saves.flush();
  saves.changed();
  resolvers.shift()!();
  await new Promise((r) => setTimeout(r, 0));
  expect(send).toHaveBeenCalledTimes(2);
  expect(saves.dirty).toBe(true);
  resolvers.shift()!();
  await flushed;
  expect(saves.dirty).toBe(false);
  saves.destroy();
});
test("failure remains dirty and reconnect obtains a fresh acknowledgement", async () => {
  const send = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(undefined);
  const saves = new SaveCoordinator(send);
  await expect(saves.flush()).rejects.toThrow("offline");
  expect(saves.dirty).toBe(true);
  await saves.flush();
  expect(saves.dirty).toBe(false);
  saves.reconnect();
  await saves.flush();
  expect(send).toHaveBeenCalledTimes(3);
  saves.destroy();
});
