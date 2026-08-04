import { PasswordService } from '../password.service';
import { isKeyboardWalk, isShortRepeatedUnit } from './blocklist';
import { foldDigitSystems, PERSIAN_LAYOUT_ROWS } from './persian-layout';
import { validatePassword } from './policy';

/**
 * Every Persian literal is built from code points rather than typed, so no
 * editor, formatter or tool can silently substitute a visually identical
 * character. The distinction between Persian yeh (U+06CC) and Arabic yeh
 * (U+064A) is invisible in most fonts and load-bearing here.
 */
const cp = (...codePoints: number[]): string => String.fromCodePoint(...codePoints);

const PERSIAN_DIGIT_ZERO = 0x06f0;
const ARABIC_INDIC_DIGIT_ZERO = 0x0660;

/** The number row as it sits on the keyboard: 1..9 then 0. */
const KEYBOARD_DIGIT_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

const persianDigits = KEYBOARD_DIGIT_ORDER.map((d) => cp(PERSIAN_DIGIT_ZERO + d)).join('');
const arabicIndicDigits = KEYBOARD_DIGIT_ORDER.map((d) => cp(ARABIC_INDIC_DIGIT_ZERO + d)).join('');

const reverse = (value: string): string => Array.from(value).reverse().join('');

/** A 15-code-point walk, wrapping the row onto itself as a real typist would. */
const walkOf = (row: string, length = 15): string =>
  Array.from(row.repeat(4)).slice(0, length).join('');

const [AD_ROW, AC_ROW, AB_ROW] = PERSIAN_LAYOUT_ROWS as [string, string, string];

/** "سیب قرمز و شیرین است" — a synthetic passphrase, 20 code points. */
const PASSPHRASE_WITH_SHORT_WORD = cp(
  0x0633,
  0x06cc,
  0x0628,
  0x0020, // سیب  (apple: three consecutive home-row keys)
  0x0642,
  0x0631,
  0x0645,
  0x0632,
  0x0020, // قرمز
  0x0648,
  0x0020, // و
  0x0634,
  0x06cc,
  0x0631,
  0x06cc,
  0x0646,
  0x0020, // شیرین
  0x0627,
  0x0633,
  0x062a, // است
);

/** "پنجره آبی صبح آرام است" — 22 code points. */
const LEGITIMATE_PASSPHRASE = cp(
  0x067e,
  0x0646,
  0x062c,
  0x0631,
  0x0647,
  0x0020, // پنجره
  0x0622,
  0x0628,
  0x06cc,
  0x0020, // آبی
  0x0635,
  0x0628,
  0x062d,
  0x0020, // صبح
  0x0622,
  0x0631,
  0x0627,
  0x0645,
  0x0020, // آرام
  0x0627,
  0x0633,
  0x062a, // است
);

describe('layout data', () => {
  it('decodes to the three ISIRI 9147 base-layer letter rows', () => {
    expect(Array.from(AD_ROW)).toHaveLength(12);
    expect(Array.from(AC_ROW)).toHaveLength(11);
    expect(Array.from(AB_ROW)).toHaveLength(8);
  });

  it('uses the Persian forms of yeh and keheh, which are the base-layer keys', () => {
    // Arabic yeh and Arabic kaf sit on the shift level and must not appear here.
    expect(AC_ROW).toContain(cp(0x06cc)); // Farsi yeh
    expect(AC_ROW).toContain(cp(0x06a9)); // keheh
    expect(AC_ROW).not.toContain(cp(0x064a)); // Arabic yeh
    expect(AC_ROW).not.toContain(cp(0x0643)); // Arabic kaf
  });

  it('keeps the rows separate rather than concatenating them', () => {
    expect(PERSIAN_LAYOUT_ROWS).toHaveLength(3);
    for (const row of PERSIAN_LAYOUT_ROWS) {
      expect(Array.from(row).length).toBeLessThanOrEqual(12);
    }
  });
});

describe('foldDigitSystems', () => {
  it('maps Persian digits to ASCII', () => {
    expect(foldDigitSystems(persianDigits)).toBe('1234567890');
  });

  it('maps Arabic-Indic digits to ASCII', () => {
    expect(foldDigitSystems(arabicIndicDigits)).toBe('1234567890');
  });

  it('leaves letters and punctuation untouched', () => {
    expect(foldDigitSystems(LEGITIMATE_PASSPHRASE)).toBe(LEGITIMATE_PASSPHRASE);
    expect(foldDigitSystems('quiet harbour drift')).toBe('quiet harbour drift');
  });

  it('folds a mixture of all three numeral systems', () => {
    const mixed = cp(PERSIAN_DIGIT_ZERO + 1) + '2' + cp(ARABIC_INDIC_DIGIT_ZERO + 3);
    expect(foldDigitSystems(mixed)).toBe('123');
  });
});

describe('sequential digits across numeral systems', () => {
  it('rejects a sequential Persian digit run', () => {
    const password = walkOf(persianDigits);

    expect(Array.from(password)).toHaveLength(15);
    expect(isKeyboardWalk(password)).toBe(true);
    expect(validatePassword(password).ok).toBe(false);
  });

  it('rejects a sequential Arabic-Indic digit run', () => {
    const password = walkOf(arabicIndicDigits);

    expect(isKeyboardWalk(password)).toBe(true);
    expect(validatePassword(password).ok).toBe(false);
  });

  it('rejects a run written in a mixture of numeral systems', () => {
    // ۱۲۳ 456 ۷۸۹۰ ١٢٣٤٥ — the same sequence, three scripts.
    const password =
      cp(PERSIAN_DIGIT_ZERO + 1, PERSIAN_DIGIT_ZERO + 2, PERSIAN_DIGIT_ZERO + 3) +
      '456' +
      cp(
        PERSIAN_DIGIT_ZERO + 7,
        PERSIAN_DIGIT_ZERO + 8,
        PERSIAN_DIGIT_ZERO + 9,
        PERSIAN_DIGIT_ZERO + 0,
      ) +
      cp(
        ARABIC_INDIC_DIGIT_ZERO + 1,
        ARABIC_INDIC_DIGIT_ZERO + 2,
        ARABIC_INDIC_DIGIT_ZERO + 3,
        ARABIC_INDIC_DIGIT_ZERO + 4,
        ARABIC_INDIC_DIGIT_ZERO + 5,
      );

    expect(Array.from(password)).toHaveLength(15);
    expect(foldDigitSystems(password)).toBe('123456789012345');
    expect(validatePassword(password).ok).toBe(false);
  });

  it('rejects a unit repeated across numeral systems', () => {
    // ۱۲۳ 123 ۱۲۳ 123 ۱۲۳ — an exact repetition once the scripts are folded.
    const persianUnit = cp(PERSIAN_DIGIT_ZERO + 1, PERSIAN_DIGIT_ZERO + 2, PERSIAN_DIGIT_ZERO + 3);
    const password = (persianUnit + '123').repeat(2) + persianUnit;

    expect(Array.from(password)).toHaveLength(15);
    expect(isShortRepeatedUnit(password)).toBe(true);
    expect(validatePassword(password).ok).toBe(false);
  });

  it('rejects a single Persian digit repeated', () => {
    const password = cp(PERSIAN_DIGIT_ZERO + 5).repeat(15);

    expect(isShortRepeatedUnit(password)).toBe(true);
    expect(validatePassword(password).ok).toBe(false);
  });
});

describe('Persian keyboard walks', () => {
  const rows: Array<[string, string]> = [
    ['AD', AD_ROW],
    ['AC', AC_ROW],
    ['AB', AB_ROW],
  ];

  it.each(rows)('rejects a forward walk along the %s row', (_label, row) => {
    const password = walkOf(row);

    expect(Array.from(password)).toHaveLength(15);
    expect(isKeyboardWalk(password)).toBe(true);
    expect(validatePassword(password).ok).toBe(false);
  });

  it.each(rows)('rejects a backward walk along the %s row', (_label, row) => {
    const password = walkOf(reverse(row));

    expect(isKeyboardWalk(password)).toBe(true);
    expect(validatePassword(password).ok).toBe(false);
  });

  it('does not treat a concatenation across two rows as a walk', () => {
    // The end of AD followed by the start of AC. Those keys are not adjacent on
    // any keyboard; calling this a walk would be inventing adjacency. Detecting
    // it would need real key-adjacency modelling and a separate review.
    const spanning =
      Array.from(AD_ROW).slice(-8).join('') + Array.from(AC_ROW).slice(0, 7).join('');

    expect(Array.from(spanning)).toHaveLength(15);
    expect(isKeyboardWalk(spanning)).toBe(false);
  });

  it('does not treat a reversed cross-row concatenation as a walk', () => {
    const spanning =
      Array.from(AC_ROW).slice(-7).join('') + Array.from(AB_ROW).slice(0, 8).join('');

    expect(isKeyboardWalk(reverse(spanning))).toBe(false);
  });
});

describe('legitimate Persian input is not rejected', () => {
  it('accepts an ordinary passphrase', () => {
    expect(Array.from(LEGITIMATE_PASSPHRASE)).toHaveLength(22);
    expect(validatePassword(LEGITIMATE_PASSPHRASE).ok).toBe(true);
  });

  it('accepts a passphrase containing a short home-row word', () => {
    // "سیب" (apple) is three consecutive keys on the home row. Whole-password
    // matching is what makes this safe: as a whole password it is 3 code points
    // and unreachable, but a substring rule would reject every passphrase that
    // mentions an apple.
    const apple = cp(0x0633, 0x06cc, 0x0628);

    expect(isKeyboardWalk(apple)).toBe(true);
    expect(PASSPHRASE_WITH_SHORT_WORD.startsWith(apple)).toBe(true);
    expect(isKeyboardWalk(PASSPHRASE_WITH_SHORT_WORD)).toBe(false);
    expect(validatePassword(PASSPHRASE_WITH_SHORT_WORD).ok).toBe(true);
  });

  it.each([
    'quiet harbour lantern drift',
    'sixteen lower case letters here',
    'abcdefgabcdefgabcdefg',
  ])('still accepts %s', (password: string) => {
    expect(validatePassword(password).ok).toBe(true);
  });
});

describe('the fold is confined to pattern detection', () => {
  const passwords = new PasswordService();

  const persianRun = walkOf(persianDigits, 16);
  const asciiRun = foldDigitSystems(persianRun);

  it('folds for detection but not for hashing or verification', async () => {
    // Both are rejected by policy, which is why this is checked at the service
    // level: the fold must not reach the hash.
    const hash = await passwords.hash(persianRun);

    expect(await passwords.verify(hash, persianRun)).toBe(true);
    // Same digits, different numeral system: a different password.
    expect(await passwords.verify(hash, asciiRun)).toBe(false);
  });

  it('produces different hashes for the two numeral systems', async () => {
    const first = await passwords.hash(persianRun);
    const second = await passwords.hash(asciiRun);

    expect(first).not.toBe(second);
    expect(await passwords.verify(second, persianRun)).toBe(false);
  });

  it('does not alter NFC normalisation', () => {
    // The fold operates on digits only; canonical composition is untouched.
    const decomposed = 'e' + cp(0x0301);
    expect(foldDigitSystems(decomposed)).toBe(decomposed);
    expect(foldDigitSystems(decomposed).normalize('NFC')).toBe(cp(0x00e9));
  });
});
