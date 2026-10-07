import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWorkerQueues } from "../packages/shared/src/worker-scheduler";

function deferred() {
  let resolve!: (worked: boolean) => void;
  const promise = new Promise<boolean>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe("bounded fair worker dispatch", () => {
  it("a slow provider does not prevent local queues from draining", async () => {
    const remote = deferred();
    const order: string[] = [];
    const run = runWorkerQueues(
      [
        {
          name: "remote",
          run: async () => {
            order.push("remote");
            return remote.promise;
          },
        },
        ...["files", "research", "planning"].map((name) => ({
          name,
          run: async () => {
            order.push(name);
            return false;
          },
        })),
      ],
      { once: true },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["remote", "files", "research", "planning"]);
    remote.resolve(false);
    await run;
  });
  it("never overlaps a queue or exceeds two active jobs", async () => {
    const first = deferred(),
      second = deferred();
    let active = 0,
      peak = 0;
    const calls = [vi.fn(), vi.fn(), vi.fn()];
    const run = runWorkerQueues(
      [first, second, null].map((item, i) => ({
        name: String(i),
        run: async () => {
          calls[i]();
          peak = Math.max(peak, ++active);
          try {
            return item ? await item.promise : false;
          } finally {
            active--;
          }
        },
      })),
      { once: true },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(calls[2]).not.toHaveBeenCalled();
    first.resolve(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls[2]).toHaveBeenCalledOnce();
    expect(peak).toBe(2);
    second.resolve(false);
    await run;
    expect(calls[0]).toHaveBeenCalledOnce();
    expect(calls[1]).toHaveBeenCalledOnce();
  });
  it("--once rechecks previously empty queues after a job enqueues work", async () => {
    let pending = false,
      dispatched = false;
    const earlier = vi.fn(async () => {
      const worked = pending;
      pending = false;
      return worked;
    });
    const later = vi.fn(async () => {
      if (dispatched) return false;
      dispatched = true;
      pending = true;
      return true;
    });
    const run = runWorkerQueues(
      [
        { name: "earlier", run: earlier },
        { name: "later", run: later },
      ],
      { concurrency: 1, once: true },
    );
    await vi.advanceTimersByTimeAsync(3000);
    await run;
    expect(earlier).toHaveBeenCalledTimes(3);
    expect(later).toHaveBeenCalledTimes(3);
    expect(pending).toBe(false);
  });
  it("does not repeatedly run maintenance during a busy drain", async () => {
    const maintenance = vi.fn(async () => false);
    let jobs = 3;
    const run = runWorkerQueues(
      [
        {
          name: "maintenance",
          run: maintenance,
          idleDelayMs: 60000,
          participatesInDrain: false,
        },
        { name: "jobs", run: async () => jobs-- > 0 },
      ],
      { once: true },
    );
    await vi.advanceTimersByTimeAsync(0);
    await run;
    expect(maintenance).toHaveBeenCalledOnce();
  });
  it("rechecks local emptiness after concurrent maintenance enqueues work", async () => {
    const maintenance = deferred();
    let pending = false;
    const local = vi.fn(async () => {
      const worked = pending;
      pending = false;
      return worked;
    });
    const run = runWorkerQueues(
      [
        {
          name: "maintenance",
          lane: "io",
          participatesInDrain: false,
          run: async () => {
            await maintenance.promise;
            pending = true;
            return false;
          },
        },
        { name: "local", lane: "local", run: local },
      ],
      { once: true },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(local).toHaveBeenCalledOnce();
    maintenance.resolve(false);
    await vi.advanceTimersByTimeAsync(3000);
    await run;
    expect(pending).toBe(false);
    expect(local).toHaveBeenCalledTimes(3);
  });
  it("cannot accept a stale empty result after another queue commits work", async () => {
    const producer = deferred(),
      staleRead = deferred();
    let pending = false,
      produced = false,
      firstRead = true,
      consumed = 0;
    const consume = vi.fn(async () => {
      if (firstRead) {
        firstRead = false;
        return staleRead.promise;
      }
      const worked = pending;
      if (worked) consumed++;
      pending = false;
      return worked;
    });
    const run = runWorkerQueues(
      [
        {
          name: "producer",
          lane: "io",
          run: async () => {
            if (produced) return false;
            produced = true;
            await producer.promise;
            pending = true;
            return true;
          },
        },
        { name: "consumer", lane: "local", run: consume },
      ],
      { once: true },
    );
    await vi.advanceTimersByTimeAsync(0);
    producer.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    // This empty snapshot began before the producer committed, even though its
    // response arrives afterwards. It must not finish the new drain generation.
    staleRead.resolve(false);
    await vi.advanceTimersByTimeAsync(3000);
    await run;
    expect(pending).toBe(false);
    expect(consumed).toBe(1);
    expect(consume.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
  it.each([undefined, 0])(
    "one-shot maintenance cannot starve the drain with idle delay %s",
    async (idleDelayMs) => {
      const maintenance = vi.fn(async () => false),
        local = vi.fn(async () => false);
      const run = runWorkerQueues(
        [
          {
            name: "maintenance",
            participatesInDrain: false,
            idleDelayMs,
            run: maintenance,
          },
          { name: "local", run: local },
        ],
        { once: true },
      );
      await vi.advanceTimersByTimeAsync(3000);
      await run;
      expect(maintenance).toHaveBeenCalledOnce();
      expect(local).toHaveBeenCalledTimes(2);
    },
  );
  it("reserves the other lane for local work when multiple slow queues are ready", async () => {
    const provider = deferred(),
      site = deferred();
    const local = vi.fn(async () => false),
      sites = vi.fn(() => site.promise);
    const run = runWorkerQueues(
      [
        { name: "provider", lane: "io", run: () => provider.promise },
        { name: "sites", lane: "io", run: sites },
        { name: "local", lane: "local", run: local },
      ],
      { once: true },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(local).toHaveBeenCalledOnce();
    expect(sites).not.toHaveBeenCalled();
    provider.resolve(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(sites).toHaveBeenCalledOnce();
    site.resolve(false);
    await run;
  });
  it("propagates a failure only after the other owned job has finished", async () => {
    const active = deferred();
    const later = vi.fn(async () => false);
    let finished = false;
    const run = runWorkerQueues([
      {
        name: "failed",
        run: async () => {
          throw new Error("fixture failure");
        },
      },
      { name: "active", run: () => active.promise },
      { name: "later", run: later },
    ]).then(
      () => {
        finished = true;
        return null;
      },
      (error: unknown) => {
        finished = true;
        return error;
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toBe(false);
    expect(later).not.toHaveBeenCalled();
    active.resolve(false);
    expect(await run).toMatchObject({ message: "fixture failure" });
  });
  it("stops claiming on shutdown and waits for active work before returning", async () => {
    const active = deferred();
    const later = vi.fn(async () => false);
    let stopping = false;
    const run = runWorkerQueues(
      [
        { name: "active", run: () => active.promise },
        { name: "later", run: later },
      ],
      { concurrency: 1, shouldStop: () => stopping },
    );
    await vi.advanceTimersByTimeAsync(0);
    stopping = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(later).not.toHaveBeenCalled();
    active.resolve(false);
    await run;
  });
  it("backs off empty queues and rejects invalid dispatcher configuration", async () => {
    const queue = { name: "idle", run: vi.fn(async () => false) };
    let stopping = false;
    const run = runWorkerQueues([queue], { shouldStop: () => stopping });
    await vi.advanceTimersByTimeAsync(2500);
    expect(queue.run).toHaveBeenCalledTimes(3);
    stopping = true;
    await vi.advanceTimersByTimeAsync(1000);
    await run;
    await expect(runWorkerQueues([queue, queue])).rejects.toThrow("unique");
    await expect(runWorkerQueues([queue], { concurrency: 3 })).rejects.toThrow(
      "one or two",
    );
  });
});
