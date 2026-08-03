import { Semaphore } from './argon2-semaphore';

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('Semaphore', () => {
  it('rejects a non-positive or non-integer limit', () => {
    expect(() => new Semaphore(0)).toThrow(/positive integer/);
    expect(() => new Semaphore(-1)).toThrow(/positive integer/);
    expect(() => new Semaphore(1.5)).toThrow(/positive integer/);
  });

  it('runs a task and returns its value', async () => {
    await expect(new Semaphore(1).run(async () => 'done')).resolves.toBe('done');
  });

  it('never exceeds the configured concurrency', async () => {
    const limit = 4;
    const semaphore = new Semaphore(limit);
    const gate = deferred();

    let active = 0;
    let peak = 0;

    const tasks = Array.from({ length: 20 }, () =>
      semaphore.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await gate.promise;
        active -= 1;
      }),
    );

    // Let every task that can start, start.
    await Promise.resolve();
    expect(peak).toBe(limit);

    gate.resolve();
    await Promise.all(tasks);

    expect(peak).toBe(limit);
    expect(active).toBe(0);
  });

  it('hands the permit to waiters in arrival order', async () => {
    const semaphore = new Semaphore(1);
    const gate = deferred();
    const order: number[] = [];

    const first = semaphore.run(async () => {
      order.push(0);
      await gate.promise;
    });

    const rest = [1, 2, 3].map((index) =>
      semaphore.run(async () => {
        order.push(index);
      }),
    );

    gate.resolve();
    await Promise.all([first, ...rest]);

    expect(order).toEqual([0, 1, 2, 3]);
  });

  it('releases the permit when a task throws, so one failure cannot deadlock login', async () => {
    const semaphore = new Semaphore(1);

    await expect(
      semaphore.run(async () => {
        throw new Error('argon2 exploded');
      }),
    ).rejects.toThrow('argon2 exploded');

    expect(semaphore.available).toBe(1);
    await expect(semaphore.run(async () => 'still works')).resolves.toBe('still works');
  });

  it('reports its own state for diagnostics', async () => {
    const semaphore = new Semaphore(2);
    const gate = deferred();

    expect(semaphore.available).toBe(2);
    expect(semaphore.waiting).toBe(0);

    const tasks = Array.from({ length: 5 }, () => semaphore.run(() => gate.promise));
    await Promise.resolve();

    expect(semaphore.available).toBe(0);
    expect(semaphore.waiting).toBe(3);

    gate.resolve();
    await Promise.all(tasks);

    expect(semaphore.available).toBe(2);
    expect(semaphore.waiting).toBe(0);
  });
});
