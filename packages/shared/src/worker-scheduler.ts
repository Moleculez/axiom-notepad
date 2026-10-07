export type WorkerQueue = {
  name: string;
  run: () => Promise<boolean>;
  idleDelayMs?: number;
  /** At most one active job per named lane, in addition to the global bound. */
  lane?: string;
  /** Maintenance does not determine whether a --once drain is finished. */
  participatesInDrain?: boolean;
};

/** Fair, bounded dispatch only. Individual services retain their transaction
 * leases, cancellation and non-replay guarantees. Shutdown drains owned work
 * before callers close their database pool. */
export async function runWorkerQueues(
  queues: WorkerQueue[],
  options: {
    concurrency?: number;
    once?: boolean;
    shouldStop?: () => boolean;
  } = {},
) {
  if (!queues.length) return;
  if (new Set(queues.map((queue) => queue.name)).size !== queues.length)
    throw new Error("Worker queue names must be unique.");
  const concurrency = options.concurrency ?? 2;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2)
    throw new Error("Worker concurrency must be one or two.");
  const active = new Map<number, Promise<void>>();
  const readyAt = queues.map(() => 0);
  const idle = new Set<number>();
  const completedMaintenance = new Set<number>();
  const drainCount = queues.filter(
    (queue) => queue.participatesInDrain !== false,
  ).length;
  let cursor = 0;
  let generation = 0;
  let failure: unknown;
  let failed = false;
  let wake = () => {};
  const stopping = () => failed || !!options.shouldStop?.();
  const drained = () =>
    options.once && idle.size === drainCount && !active.size;
  while (!stopping() && !drained()) {
    for (
      let attempts = 0;
      attempts < queues.length && active.size < concurrency;
      attempts++
    ) {
      const index = cursor;
      cursor = (cursor + 1) % queues.length;
      if (active.has(index) || readyAt[index] > Date.now()) continue;
      const queue = queues[index];
      // A one-shot drain runs maintenance once. Repeating a non-drain queue
      // could continually invalidate emptiness and prevent the drain finishing.
      if (options.once && completedMaintenance.has(index)) continue;
      if (
        queue.lane &&
        [...active.keys()].some((other) => queues[other].lane === queue.lane)
      )
        continue;
      const startedGeneration = generation;
      const work = Promise.resolve()
        .then(queue.run)
        .then((worked) => {
          if (worked || queue.participatesInDrain === false) {
            // A job may enqueue work in a queue that was empty earlier. A drain
            // finishes only after every participating queue is empty again,
            // including reads that were already in flight during this job.
            generation++;
            idle.clear();
          }
          if (queue.participatesInDrain === false)
            completedMaintenance.add(index);
          if (worked) {
            readyAt[index] = 0;
          } else {
            if (
              queue.participatesInDrain !== false &&
              startedGeneration === generation
            )
              idle.add(index);
            readyAt[index] = Date.now() + (queue.idleDelayMs ?? 1000);
          }
        })
        .catch((error: unknown) => {
          if (!failed) failure = error;
          failed = true;
        })
        .finally(() => {
          active.delete(index);
          wake();
        });
      active.set(index, work);
    }
    if (stopping() || drained()) break;
    // Completion wakes dispatch immediately; a bounded timer observes signals
    // and idle queues even if another lane is awaiting a remote provider.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        wake = () => {};
        resolve();
      }, 1000);
      wake = () => {
        clearTimeout(timer);
        wake = () => {};
        resolve();
      };
    });
  }
  await Promise.all(active.values());
  if (failed) throw failure;
}
