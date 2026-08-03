/**
 * A minimal FIFO counting semaphore.
 *
 * Argon2id is configured to allocate 19 MiB per verification. Without a bound,
 * concurrent login attempts multiply that figure directly into host memory, so
 * the parameter chosen to resist GPU cracking becomes a way to exhaust the
 * server. Capping concurrency bounds peak hashing memory and makes Argon2's own
 * cost the throughput limit on the login endpoint.
 *
 * Excess work queues rather than allocating. This is a single-process bound;
 * it is not a distributed rate limiter and does not pretend to be one.
 */
export class Semaphore {
  #available: number;
  readonly #waiting: Array<() => void> = [];

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`Semaphore limit must be a positive integer, received ${String(limit)}`);
    }
    this.#available = limit;
  }

  /** Free slots right now. Exposed for tests and diagnostics only. */
  get available(): number {
    return this.#available;
  }

  /** Tasks queued behind a full semaphore. Exposed for tests and diagnostics only. */
  get waiting(): number {
    return this.#waiting.length;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.#acquire();
    try {
      return await task();
    } finally {
      this.#release();
    }
  }

  #acquire(): Promise<void> {
    if (this.#available > 0) {
      this.#available -= 1;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.#waiting.push(resolve);
    });
  }

  #release(): void {
    const next = this.#waiting.shift();

    if (next === undefined) {
      this.#available += 1;
      return;
    }

    // Hand the permit straight to the next waiter rather than incrementing and
    // letting it re-acquire, which would allow a later arrival to overtake.
    next();
  }
}
