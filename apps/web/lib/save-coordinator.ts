/** One revision-aware confirmation queue shared by note and studio clients.
 * Local journals remain immediate; this coalesces server materialization checks. */
export class SaveCoordinator {
  private revision = 0;
  private confirmed = -1;
  private running: Promise<void> | null = null;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private epoch = 0;
  constructor(
    private send: () => Promise<void>,
    private delay = 1500,
    private maximum = 5000,
  ) {}
  get dirty() {
    return this.confirmed < this.revision;
  }
  changed() {
    if (this.closed) return;
    this.revision++;
    this.schedule();
  }
  schedule() {
    if (this.closed || !this.dirty) return;
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.background(), this.delay);
    this.deadline ??= setTimeout(() => this.background(), this.maximum);
  }
  private background() {
    clearTimeout(this.idle);
    clearTimeout(this.deadline);
    this.idle = this.deadline = undefined;
    void this.confirm().catch(() => {
      /* The transport owns error/recovery UI. */
    });
  }
  /** A retry/focus event is a no-op when this content is already acknowledged. */
  confirm(): Promise<void> {
    if (this.closed)
      return Promise.reject(new Error("This document session is closed."));
    if (this.running) return this.running;
    if (!this.dirty) return Promise.resolve();
    const at = this.revision,
      epoch = this.epoch;
    this.running = this.send()
      .then(() => {
        if (epoch === this.epoch) this.confirmed = Math.max(this.confirmed, at);
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }
  /** Explicit boundaries wait for edits made during an in-flight confirmation. */
  async flush() {
    clearTimeout(this.idle);
    clearTimeout(this.deadline);
    this.idle = this.deadline = undefined;
    while (this.dirty && !this.closed) await this.confirm();
    if (this.closed) throw new Error("This document session is closed.");
  }
  reconnect() {
    this.epoch++;
    this.confirmed = -1;
  }
  destroy() {
    this.closed = true;
    clearTimeout(this.idle);
    clearTimeout(this.deadline);
  }
}
