/** Serialize durable writes while keeping only the newest waiting checkpoint.
 * In-flight bytes are never cancelled; callers resolve only after the queue is
 * committed. This bounds memory under slow IndexedDB/storage pressure. */
export class LatestCheckpoint<T> {
  private pending: { value: T } | null = null;
  private running: Promise<void> | null = null;
  constructor(private commit: (value: T) => Promise<void>) {}
  write(value: T): Promise<void> {
    this.pending = { value };
    if (!this.running) this.running = this.drain();
    return this.running;
  }
  private async drain() {
    try {
      while (this.pending) {
        const checkpoint = this.pending;
        this.pending = null;
        try {
          await this.commit(checkpoint.value);
        } catch (e) {
          this.pending ??= checkpoint;
          throw e;
        }
      }
    } finally {
      // Release in the same microtask as the last pending check. Releasing in
      // Promise.finally leaves a gap where a new write can join an ended drain.
      this.running = null;
    }
  }
}
