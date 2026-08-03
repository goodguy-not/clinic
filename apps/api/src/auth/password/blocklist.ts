import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
 * True when the whole string is a short unit repeated: `aaaa...`, `abababab...`,
 * `123123123...`.
 *
 * `(s + s).indexOf(s, 1)` is the classic smallest-period trick: the index at
 * which `s` reappears in its own doubling is its period. A period shorter than
 * the string means the string repeats; a period of at most 4 means the unit is
 * short enough to be worthless.
 *
 * Known limitation: this finds exact periods only, so a truncated repetition
 * such as `1231231231231231` (16 characters, period 3 with a remainder) is not
 * caught. A minimum-distinct-code-point rule would catch that class, but it is
 * a different policy than the one approved, so it is not implemented here.
 */
const MAX_REPEATED_UNIT_LENGTH = 4;

export function isShortRepeatedUnit(foldedPassword: string): boolean {
  if (foldedPassword.length === 0) return false;

  const period = (foldedPassword + foldedPassword).indexOf(foldedPassword, 1);
  if (period <= 0 || period >= foldedPassword.length) return false;

  return period <= MAX_REPEATED_UNIT_LENGTH;
}

/**
 * Straight walks across a QWERTY keyboard or the alphabet, in either direction.
 *
 * A password is a walk when it is a contiguous slice of one of these sequences.
 * The digit row is tripled so that wrap-around slices such as `123456789012345`
 * are covered.
 */
const WALK_SEQUENCES: readonly string[] = [
  '1234567890'.repeat(3),
  'qwertyuiopasdfghjklzxcvbnm',
  'qazwsxedcrfvtgbyhnujmikolp',
  'abcdefghijklmnopqrstuvwxyz',
];

function reverse(value: string): string {
  return Array.from(value).reverse().join('');
}

const WALK_HAYSTACKS: readonly string[] = WALK_SEQUENCES.flatMap((sequence) => [
  sequence,
  reverse(sequence),
]);

export function isKeyboardWalk(foldedPassword: string): boolean {
  if (foldedPassword.length === 0) return false;
  return WALK_HAYSTACKS.some((haystack) => haystack.includes(foldedPassword));
}
