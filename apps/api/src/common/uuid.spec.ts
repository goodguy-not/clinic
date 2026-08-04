import { uuidv7 } from './uuid';

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('uuidv7', () => {
  it('produces a canonically formatted UUID', () => {
    expect(uuidv7()).toMatch(UUID_SHAPE);
  });

  it('sets version 7 and the RFC 4122 variant', () => {
    for (let i = 0; i < 50; i += 1) {
      const value = uuidv7();
      expect(value[14]).toBe('7');
      expect(['8', '9', 'a', 'b']).toContain(value[19]);
    }
  });

  it('is accepted by the request-id UUID validator', () => {
    // The middleware only accepts versions 1-8 with a standard variant, and
    // audit `request_id` is a uuid column, so a generated id has to satisfy it.
    const strict = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(uuidv7()).toMatch(strict);
  });

  it('sorts in generation order, which is the point of using v7', () => {
    const first = uuidv7();
    const later: string[] = [];

    // Same millisecond values may tie; span a few milliseconds to compare.
    const start = Date.now();
    while (Date.now() - start < 5) {
      /* spin briefly */
    }
    for (let i = 0; i < 5; i += 1) later.push(uuidv7());

    for (const value of later) {
      expect(value > first).toBe(true);
    }
  });

  it('does not repeat', () => {
    const values = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(values.size).toBe(1000);
  });
});
