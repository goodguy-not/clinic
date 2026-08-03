import { PASSWORD_MAX_BYTES, PASSWORD_MIN_CODE_POINTS } from '../auth-policy';
import { validatePassword } from './policy';
import {
  countCodePoints,
  isWellFormedUnicode,
  normalizePassword,
  utf8ByteLength,
} from './normalize';

/**
 * Grapheme counting exists ONLY in this test. Production code must never count
 * graphemes — the point of the table below is to prove that the three notions
 * of length genuinely disagree on real inputs, so a future edit that switched
 * the implementation from code points to `.length` or to graphemes would fail
 * here rather than silently change who can log in.
 */
function countGraphemes(value: string): number {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(value)).length;
}

/**
 * Every fixture is written with explicit escapes rather than literal
 * characters. A literal e-acute in this file could already be precomposed,
 * which would silently defeat the test proving NFC runs before counting.
 */

/** U+1D51E MATHEMATICAL FRAKTUR SMALL A: one code point, two UTF-16 units. */
const FRAKTUR_A = '\u{1D51E}';

/** Four astral emoji joined by three U+200D: 7 code points, 1 grapheme. */
const FAMILY = '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}';

/** "e" + U+0301 COMBINING ACUTE ACCENT, canonically equivalent to U+00E9. */
const E_DECOMPOSED = 'é';

/** U+0645 ARABIC LETTER MEEM: one UTF-16 unit, two UTF-8 bytes. */
const MEEM = 'م';

type Fixture = {
  readonly label: string;
  readonly raw: string;
  readonly utf16Units: number;
  readonly codePoints: number;
  readonly graphemes: number;
  readonly tooShort: boolean;
};

const FIXTURES: readonly Fixture[] = [
  {
    label: '15 ASCII',
    raw: 'a'.repeat(15),
    utf16Units: 15,
    codePoints: 15,
    graphemes: 15,
    tooShort: false,
  },
  {
    label: '14 ASCII',
    raw: 'a'.repeat(14),
    utf16Units: 14,
    codePoints: 14,
    graphemes: 14,
    tooShort: true,
  },
  {
    label: '15 astral: proves the count is not UTF-16 units',
    raw: FRAKTUR_A.repeat(15),
    utf16Units: 30,
    codePoints: 15,
    graphemes: 15,
    tooShort: false,
  },
  {
    label: '8 astral: .length would wrongly report 16 and let this pass',
    raw: FRAKTUR_A.repeat(8),
    utf16Units: 16,
    codePoints: 8,
    graphemes: 8,
    tooShort: true,
  },
  {
    label: '3 ZWJ families: proves the count is not graphemes',
    raw: FAMILY.repeat(3),
    utf16Units: 33,
    codePoints: 21,
    graphemes: 3,
    tooShort: false,
  },
  {
    label: '15 decomposed e-acute: proves NFC runs before counting',
    raw: E_DECOMPOSED.repeat(15),
    utf16Units: 30,
    codePoints: 15,
    graphemes: 15,
    tooShort: false,
  },
  {
    label: '14 decomposed e-acute: same proof, negative side',
    raw: E_DECOMPOSED.repeat(14),
    utf16Units: 28,
    codePoints: 14,
    graphemes: 14,
    tooShort: true,
  },
];

describe('password length measurement', () => {
  it.each(FIXTURES)('$label', ({ raw, utf16Units, codePoints, graphemes, tooShort }: Fixture) => {
    // Raw UTF-16 length, which is what `.length` would have used.
    expect(raw.length).toBe(utf16Units);

    const normalization = normalizePassword(raw);
    expect(normalization.ok).toBe(true);
    if (!normalization.ok) return;

    const { normalized } = normalization;
    expect(countCodePoints(normalized)).toBe(codePoints);
    expect(countGraphemes(normalized)).toBe(graphemes);

    const result = validatePassword(raw);
    const violations = result.ok ? [] : result.violations;
    expect(violations.includes('TOO_SHORT')).toBe(tooShort);
  });

  it('the three notions genuinely disagree, so the choice is load-bearing', () => {
    const astral = FRAKTUR_A.repeat(8);
    expect(astral.length).toBe(16);
    expect(countCodePoints(astral)).toBe(8);
    expect(countGraphemes(astral)).toBe(8);

    const families = FAMILY.repeat(3);
    expect(families.length).toBe(33);
    expect(countCodePoints(families)).toBe(21);
    expect(countGraphemes(families)).toBe(3);
  });

  it('accepts exactly the minimum and rejects one code point below it', () => {
    const atMinimum = FRAKTUR_A.repeat(PASSWORD_MIN_CODE_POINTS);
    const belowMinimum = FRAKTUR_A.repeat(PASSWORD_MIN_CODE_POINTS - 1);

    const above = validatePassword(atMinimum);
    expect(above.ok ? [] : above.violations).not.toContain('TOO_SHORT');

    const below = validatePassword(belowMinimum);
    expect(below.ok ? [] : below.violations).toContain('TOO_SHORT');
  });
});

describe('ill-formed Unicode', () => {
  it('rejects a lone high surrogate before any other check', () => {
    const raw = '\uD800' + 'a'.repeat(20);

    expect(isWellFormedUnicode(raw)).toBe(false);
    expect(normalizePassword(raw)).toEqual({ ok: false, reason: 'ILL_FORMED_UNICODE' });

    const result = validatePassword(raw);
    expect(result.ok).toBe(false);
    // Only the guard violation, proving nothing downstream ran.
    expect(result.ok ? [] : result.violations).toEqual(['ILL_FORMED_UNICODE']);
  });

  it('rejects a lone low surrogate', () => {
    expect(isWellFormedUnicode('\uDC00' + 'a'.repeat(20))).toBe(false);
  });

  it('accepts a well-formed surrogate pair, which is a single astral code point', () => {
    expect(isWellFormedUnicode(FRAKTUR_A.repeat(15))).toBe(true);
    expect(isWellFormedUnicode(FAMILY)).toBe(true);
  });
});

describe('byte limits', () => {
  it('rejects input over the byte cap', () => {
    const raw = 'a'.repeat(PASSWORD_MAX_BYTES + 1);

    expect(utf8ByteLength(raw)).toBeGreaterThan(PASSWORD_MAX_BYTES);
    expect(normalizePassword(raw)).toEqual({ ok: false, reason: 'TOO_MANY_BYTES' });
  });

  it('counts bytes, not characters, so multi-byte text hits the cap sooner', () => {
    const raw = MEEM.repeat(PASSWORD_MAX_BYTES / 2 + 1);

    expect(raw.length).toBeLessThan(PASSWORD_MAX_BYTES);
    expect(utf8ByteLength(raw)).toBeGreaterThan(PASSWORD_MAX_BYTES);
    expect(normalizePassword(raw)).toEqual({ ok: false, reason: 'TOO_MANY_BYTES' });
  });

  it('accepts input exactly at the byte cap', () => {
    expect(normalizePassword('a'.repeat(PASSWORD_MAX_BYTES)).ok).toBe(true);
  });
});

describe('NFC normalisation', () => {
  it('normalises decomposed sequences to their precomposed form', () => {
    // The fixture really is two code points, and NFC really does collapse it to
    // one. Asserted with escapes so neither side can be silently precomposed by
    // an editor.
    expect(Array.from(E_DECOMPOSED)).toEqual(['e', '́']);

    const result = normalizePassword(E_DECOMPOSED);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(Array.from(result.normalized)).toEqual(['é']);
  });

  it('leaves an already-normalised string untouched', () => {
    const raw = 'a-perfectly-ordinary-passphrase';
    const result = normalizePassword(raw);
    expect(result.ok && result.normalized).toBe(raw);
  });
});
