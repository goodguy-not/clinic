import { createConcurrencyGate } from './concurrency-gate';

describe('createConcurrencyGate', () => {
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

  function deferred() {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it('never runs more than the limit at once, and starts waiters in arrival order', async () => {
    const run = createConcurrencyGate(1);
    const started: number[] = [];
    let active = 0;
    let maxActive = 0;
    const gates = [deferred(), deferred(), deferred()];

    const all = gates.map((gate, index) =>
      run(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        started.push(index);
        await gate.promise;
        active -= 1;
        return index;
      }),
    );

    await tick();
    expect(started).toEqual([0]);

    gates[0]!.resolve();
    await tick();
    expect(started).toEqual([0, 1]);

    gates[1]!.resolve();
    gates[2]!.resolve();

    await expect(Promise.all(all)).resolves.toEqual([0, 1, 2]);
    expect(maxActive).toBe(1);
  });

  it('releases the slot when the work fails, so the queue keeps moving', async () => {
    const run = createConcurrencyGate(1);
    const failing = deferred();

    const first = run(() => failing.promise);
    const second = run(async () => 'ran');

    failing.reject(new Error('synthetic failure'));

    await expect(first).rejects.toThrow('synthetic failure');
    await expect(second).resolves.toBe('ran');
  });

  it('allows up to the limit concurrently', async () => {
    const run = createConcurrencyGate(2);
    let active = 0;
    let maxActive = 0;
    const gate = deferred();

    const all = [0, 1, 2, 3].map(() =>
      run(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await gate.promise;
        active -= 1;
      }),
    );

    await tick();
    expect(active).toBe(2);
    gate.resolve();
    await Promise.all(all);
    expect(maxActive).toBe(2);
  });

  it('refuses a limit that is not a positive integer', () => {
    expect(() => createConcurrencyGate(0)).toThrow();
    expect(() => createConcurrencyGate(1.5)).toThrow();
  });
});
