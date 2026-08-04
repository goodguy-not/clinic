import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { foldDigitSystems, PERSIAN_LAYOUT_ROWS } from './persian-layout';

/**
 * Blocklist checks, run on the NFC-normalised, case-folded password.
 *
 * At a 15-code-point minimum a common-password corpus is almost entirely
 * irrelevant — nearly every entry is already rejected on length. The realistic
 * ways a long password is still weak are: a short unit repeated, a keyboard
 * walk, or something derived from the account or the clinic. Those are the
 * checks below; the committed list covers the long-but-weak residue.
 *
 * `common-passwords-min15.txt` is copied into `dist/` by the `assets` entry in
 * `nest-cli.json`, so `__dirname` resolves in both `src` (tests) and `dist`
 * (runtime).
 */

const BLOCKLIST_FILE = 'common-passwords-min15.txt';

function loadBlocklist(): ReadonlySet<string> {
  const contents = readFileSync(join(__dirname, BLOCKLIST_FILE), 'utf8');

  const entries = contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.toLowerCase());

  return new Set(entries);
}

let cachedBlocklist: ReadonlySet<string> | undefined;

export function commonPasswordBlocklist(): ReadonlySet<string> {
  cachedBlocklist ??= loadBlocklist();
  return cachedBlocklist;
}

export function isCommonPassword(foldedPassword: string): boolean {
  return commonPasswordBlocklist().has(foldedPassword);
}

/**
 * Clinic-specific blocked terms — brand words, the clinic name, the domain.
 *
 * Environmental rather than committed: these are owner-provided and would be
 * clinic-identifying strings in the repository. An unset variable yields an
 * empty list, which is the correct behaviour before the owner supplies them.
 */
export function parseBlockedTerms(raw: string | undefined): readonly string[] {
  if (raw === undefined) return [];

  return raw
    .split(',')
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length > 0);
}

export function containsBlockedTerm(
  foldedPassword: string,
  blockedTerms: readonly string[],
): boolean {
  return blockedTerms.some((term) => foldedPassword.includes(term));
}

export function containsUsername(foldedPassword: string, username: string): boolean {
  const folded = username.trim().toLowerCase();
  return folded.length > 0 && foldedPassword.includes(folded);
}

/**
 * True when the WHOLE password is an exact repetition of a unit of 1 to 6 code
 * points: `aaaa...`, `abababab...`, `salamsalamsalam`, `۱۲۳۱۲۳۱۲۳...`.
 *
 * Raised from 4 to 6 for this locale. Common Finglish words — `salam`,
 * `azizam`, `khoshgel` — are five and six characters, so a threshold of 4 let
 * `salamsalamsalam` through while catching the equivalent three-letter pattern.
 * The same change catches `abcdeabcdeabcde` in ASCII.
 *
 * Measured in CODE POINTS, not UTF-16 units, matching how the length policy
 * measures. Digits are folded first, so a unit repeated across numeral systems
 * (`۱۲۳123۱۲۳123۱۲۳`) is recognised as the repetition it is.
 *
 * Only an exact whole-string repetition counts. A passphrase is not rejected
 * merely because some short substring happens to appear more than once — the
 * unit has to tile the entire password with no remainder.
 *
 * Known limitation, unchanged: a truncated repetition such as
 * `1231231231231231` (16 code points, unit 3 with a remainder) is not caught.
 * A minimum-distinct-code-point rule would catch that class, but it is a
 * different policy than the one approved.
 */
const MAX_REPEATED_UNIT_LENGTH = 6;

export function isShortRepeatedUnit(foldedPassword: string): boolean {
  const codePoints = Array.from(foldDigitSystems(foldedPassword));
  if (codePoints.length === 0) return false;

  for (let unitLength = 1; unitLength <= MAX_REPEATED_UNIT_LENGTH; unitLength += 1) {
    // The unit must tile the password exactly, and the password must be more
    // than one copy of it.
    if (codePoints.length <= unitLength) break;
    if (codePoints.length % unitLength !== 0) continue;

    let tiles = true;
    for (let index = unitLength; index < codePoints.length; index += 1) {
      if (codePoints[index] !== codePoints[index % unitLength]) {
        tiles = false;
        break;
      }
    }

    if (tiles) return true;
  }

  return false;
}

/**
 * Straight walks across a keyboard or the alphabet, in either direction.
 *
 * Matching is WHOLE-PASSWORD: the entire password must be a contiguous slice of
 * a sequence. It is never substring matching, and for the Persian rows that
 * distinction is load-bearing rather than stylistic. Slices of the Persian home
 * row are real words — `سیب` (apple), `بلا`, `تنم`, `لات` are each three
 * consecutive keys — so a substring rule would reject any passphrase containing
 * "apple". They are all 3 code points against a 15 code-point minimum, so as
 * whole passwords they are unreachable. If anyone ever changes this to
 * substring matching, Persian breaks first and worst.
 *
 * Each sequence is repeated so that a walk which runs off the end of a row and
 * continues from its start is still recognised — that is what someone typing
 * across a short row actually does. Repetition is always of the SAME row; rows
 * are never joined to each other (see `persian-layout.ts`).
 */
const WALK_REPEATS = 3;

const LATIN_WALK_SEQUENCES: readonly string[] = [
  '1234567890'.repeat(WALK_REPEATS),
  'qwertyuiopasdfghjklzxcvbnm',
  'qazwsxedcrfvtgbyhnujmikolp',
  'abcdefghijklmnopqrstuvwxyz',
];

/**
 * Each Persian row on its own, repeated for wrap-around.
 *
 * The rows are 8 to 12 keys and the minimum password is 15 code points, so a
 * Persian walk is only expressible as a wrap: `ضصثقفغعهخحجچضصث` is the AD row
 * typed through and begun again.
 */
const PERSIAN_WALK_SEQUENCES: readonly string[] = PERSIAN_LAYOUT_ROWS.map((row) =>
  row.repeat(WALK_REPEATS),
);

function reverse(value: string): string {
  return Array.from(value).reverse().join('');
}

const WALK_HAYSTACKS: readonly string[] = [
  ...LATIN_WALK_SEQUENCES,
  ...PERSIAN_WALK_SEQUENCES,
].flatMap((sequence) => [sequence, reverse(sequence)]);

export function isKeyboardWalk(foldedPassword: string): boolean {
  const candidate = foldDigitSystems(foldedPassword);
  if (candidate.length === 0) return false;

  return WALK_HAYSTACKS.some((haystack) => haystack.includes(candidate));
}
