/**
 * A process-wide FIFO bound on how many callers run a piece of work at once.
 *
 * Milestone 9.5 stabilisation. It exists for image derivation: one worst-case
 * derivation decodes a ~50 MP bitmap and adds roughly 270–290 MiB of RSS, and
 * N concurrent derivations add roughly N times that. Uploads themselves stay
 * buffered (≤12 MiB each); this caps the part that is not. See DECISION_LOG,
 * 2026-09-23 — "Uploads stay buffered in memory, and image derivation runs one
 * at a time".
 *
 * A failure inside the work releases its slot exactly as a success does, so
 * one corrupt upload can never wedge the queue behind it.
 */
export function createConcurrencyGate(limit: number) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`A concurrency gate needs a positive integer limit, got ${limit}`);
  }

  let running = 0;
  const waiting: Array<() => void> = [];

  const release = () => {
    const next = waiting.shift();
    if (next === undefined) running -= 1;
    else next();
  };

  return async function run<T>(work: () => Promise<T>): Promise<T> {
    if (running < limit) running += 1;
    else await new Promise<void>((resolve) => waiting.push(resolve));

    try {
      return await work();
    } finally {
      release();
    }
  };
}
