/**
 * Persian and Arabic-Indic digit handling for form input.
 *
 * A Persian keyboard produces ۰-۹, and a manager typing a duration will use
 * them without thinking about it. Rejecting that input would be a bug the user
 * cannot diagnose, so numeric fields accept either set and are folded to ASCII
 * before validation.
 *
 * Folding only. There is no yeh/kaf normalisation, no whitespace rewriting and
 * nothing else that changes what a user typed — names are canonicalised by
 * trimming alone, and that happens elsewhere.
 *
 * This is a small, independent reimplementation rather than a reuse of the
 * API's `foldDigitSystems`: that one belongs to password comparison, lives
 * behind `apps/api/src/auth/`, and the architecture boundary check keeps it
 * there.
 */

const PERSIAN_ZERO = 0x06f0;
const ARABIC_ZERO = 0x0660;

/** Rewrites Persian and Arabic-Indic digits as ASCII, leaving everything else alone. */
export function toWesternDigits(value: string): string {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;

      if (code >= PERSIAN_ZERO && code <= PERSIAN_ZERO + 9) {
        return String(code - PERSIAN_ZERO);
      }
      if (code >= ARABIC_ZERO && code <= ARABIC_ZERO + 9) {
        return String(code - ARABIC_ZERO);
      }

      return character;
    })
    .join('');
}

/**
 * Parses a list of whole numbers typed into one field.
 *
 * Accepts the Persian comma (`،`) alongside the ASCII one, plus spaces and
 * newlines, because all four are what people actually type. Returns `null` for
 * any token that is not a whole number, so a typo becomes a validation error
 * rather than a silently dropped duration.
 */
export function parseNumberList(value: string): number[] | null {
  const tokens = toWesternDigits(value)
    .split(/[,،\s]+/)
    .map((token) => token.trim())
    .filter((token) => token !== '');

  const numbers: number[] = [];

  for (const token of tokens) {
    if (!/^\d+$/.test(token)) return null;

    const parsed = Number(token);
    if (!Number.isSafeInteger(parsed)) return null;

    numbers.push(parsed);
  }

  return numbers;
}
