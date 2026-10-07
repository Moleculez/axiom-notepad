/** Presentation-only coalescing. Explicit boundaries consume the final sample
 * synchronously; cancellation never invokes the callback. */
export class LatestFrame<T> {
  private pending: T | undefined;
  private frame = 0;
  constructor(
    private apply: (value: T) => void,
    private request = (callback: FrameRequestCallback) =>
      requestAnimationFrame(callback),
    private cancelFrame = (id: number) => cancelAnimationFrame(id),
  ) {}
  push(value: T) {
    this.pending = value;
    if (!this.frame) this.frame = this.request(() => this.flush());
  }
  flush(value?: T) {
    if (value !== undefined) this.pending = value;
    if (this.frame) this.cancelFrame(this.frame);
    this.frame = 0;
    const pending = this.pending;
    this.pending = undefined;
    if (pending !== undefined) this.apply(pending);
  }
  cancel() {
    if (this.frame) this.cancelFrame(this.frame);
    this.frame = 0;
    this.pending = undefined;
  }
}

/** Rate-limited ephemeral presence, with a trailing latest position. */
export class LatestThrottle<T> {
  private pending: T | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private at = -Infinity;
  constructor(
    private apply: (value: T) => void,
    private interval = 50,
  ) {}
  push(value: T) {
    this.pending = value;
    if (this.timer !== undefined) return;
    const delay = Math.max(0, this.interval - (performance.now() - this.at));
    const send = () => {
      this.timer = undefined;
      this.at = performance.now();
      const pending = this.pending;
      this.pending = undefined;
      if (pending !== undefined) this.apply(pending);
    };
    if (delay) this.timer = setTimeout(send, delay);
    else send();
  }
  cancel() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
  }
}
