import { constantTimeEquals } from './constant-time';

describe('constantTimeEquals', () => {
  it('accepts an exact match', () => {
    expect(constantTimeEquals('correct-key-value', 'correct-key-value')).toBe(true);
  });

  it('rejects a wrong value of the same length', () => {
    expect(constantTimeEquals('a'.repeat(32), 'b'.repeat(32))).toBe(false);
  });

  it('rejects a wrong value of a different length without throwing', () => {
    // `timingSafeEqual` throws on unequal buffer lengths, which would leak the
    // expected length through an early exception. Hashing first makes both
    // sides 32 bytes, so a short guess fails the same way a long one does.
    expect(() => constantTimeEquals('short', 'a'.repeat(64))).not.toThrow();
    expect(constantTimeEquals('short', 'a'.repeat(64))).toBe(false);
  });

  it('rejects an empty provided value', () => {
    expect(constantTimeEquals('', 'expected')).toBe(false);
  });

  it('is case and whitespace sensitive', () => {
    expect(constantTimeEquals('Key', 'key')).toBe(false);
    expect(constantTimeEquals('key ', 'key')).toBe(false);
  });
});
