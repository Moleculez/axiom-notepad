import { test, expect } from "vitest";
import { LatestCheckpoint } from "../apps/web/lib/latest-checkpoint";
test("a checkpoint arriving between completion microtasks starts a new drain", async () => {
  const values: number[] = [];
  const queue = new LatestCheckpoint<number>(async (value) => {
    values.push(value);
  });
  const first = queue.write(1);
  let second: Promise<void> | undefined;
  queueMicrotask(() => {
    second = queue.write(2);
  });
  await first;
  await second;
  expect(values).toEqual([1, 2]);
});
test("slow durable storage retains only the newest waiting checkpoint", async () => {
  const values: number[] = [],
    releases: (() => void)[] = [];
  const queue = new LatestCheckpoint<number>(async (value) => {
    values.push(value);
    await new Promise<void>((r) => releases.push(r));
  });
  let committed = false;
  const first = queue.write(1).then(() => {
    committed = true;
  });
  queue.write(2);
  const final = queue.write(3);
  expect(values).toEqual([1]);
  releases.shift()!();
  await new Promise((r) => setTimeout(r, 0));
  expect(values).toEqual([1, 3]);
  expect(committed).toBe(false);
  releases.shift()!();
  await Promise.all([first, final]);
  expect(committed).toBe(true);
});
test("a failed checkpoint never acknowledges and a later write can recover", async () => {
  let fail = true;
  const values: number[] = [];
  const queue = new LatestCheckpoint<number>(async (value) => {
    if (fail) throw new Error("disk full");
    values.push(value);
  });
  await expect(queue.write(1)).rejects.toThrow("disk full");
  fail = false;
  await queue.write(2);
  expect(values).toEqual([2]);
});
