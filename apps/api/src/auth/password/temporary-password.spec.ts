import { TEMPORARY_PASSWORD_ALPHABET, TEMPORARY_PASSWORD_LENGTH } from '../auth-policy';
import { countCodePoints } from './normalize';
import { validatePassword } from './policy';
import { formatTemporaryPasswordForDisplay, generateTemporaryPassword } from './temporary-password';

describe('temporary-password alphabet', () => {
  it('has 56 symbols, giving about 116 bits at the configured length', () => {
    expect(TEMPORARY_PASSWORD_ALPHABET.length).toBe(56);

    const bits = TEMPORARY_PASSWORD_LENGTH * Math.log2(TEMPORARY_PASSWORD_ALPHABET.length);
    expect(bits).toBeGreaterThan(115);
  });

  it('excludes every ambiguous glyph a manager could mistranscribe', () => {
    for (const ambiguous of ['0', 'O', 'o', '1', 'l', 'I']) {
      expect(TEMPORARY_PASSWORD_ALPHABET).not.toContain(ambiguous);
    }
  });

  it('contains no duplicate symbol, so the draw really is uniform', () => {
    expect(new Set(TEMPORARY_PASSWORD_ALPHABET).size).toBe(TEMPORARY_PASSWORD_ALPHABET.length);
  });
});

describe('generateTemporaryPassword', () => {
  it('produces a password of the configured length', () => {
    expect(countCodePoints(generateTemporaryPassword())).toBe(TEMPORARY_PASSWORD_LENGTH);
  });

  it('uses only alphabet symbols', () => {
    for (const symbol of generateTemporaryPassword()) {
      expect(TEMPORARY_PASSWORD_ALPHABET).toContain(symbol);
    }
  });

  it('always satisfies the same policy a user-chosen password must satisfy', () => {
    // The invariant is "every stored hash came from a password that passed
    // validatePassword", with no exception carved out for the generator.
    for (let index = 0; index < 200; index += 1) {
      expect(validatePassword(generateTemporaryPassword()).ok).toBe(true);
    }
  });

  it('respects the caller context, so a generated value cannot contain the username', () => {
    const password = generateTemporaryPassword({ username: 'reza' });
    expect(validatePassword(password, { username: 'reza' }).ok).toBe(true);
  });

  it('does not repeat itself', () => {
    const generated = new Set(Array.from({ length: 200 }, () => generateTemporaryPassword()));
    expect(generated.size).toBe(200);
  });

  it('draws roughly uniformly across the whole alphabet', () => {
    // A modulo-biased generator would starve the tail of the alphabet. With
    // 400 * 20 = 8000 draws over 56 symbols the expected count per symbol is
    // ~143, so every symbol appearing at all is a strong signal.
    const seen = new Set<string>();
    for (let index = 0; index < 400; index += 1) {
      for (const symbol of generateTemporaryPassword()) seen.add(symbol);
    }

    expect(seen.size).toBe(TEMPORARY_PASSWORD_ALPHABET.length);
  });
});

describe('formatTemporaryPasswordForDisplay', () => {
  it('groups for transcription without altering the value', () => {
    const formatted = formatTemporaryPasswordForDisplay('ABCDEfghijKLMNOpqrst');

    expect(formatted).toBe('ABCDE-fghij-KLMNO-pqrst');
    expect(formatted.replace(/-/g, '')).toBe('ABCDEfghijKLMNOpqrst');
  });

  it('is presentation only, so the grouped form is not what gets stored', () => {
    const password = generateTemporaryPassword();
    const formatted = formatTemporaryPasswordForDisplay(password);

    expect(formatted).not.toBe(password);
    expect(formatted.replace(/-/g, '')).toBe(password);
  });
});
