import { randomInt } from 'node:crypto';
import {
  TEMPORARY_PASSWORD_ALPHABET,
  TEMPORARY_PASSWORD_DISPLAY_GROUP_SIZE,
  TEMPORARY_PASSWORD_LENGTH,
} from '../auth-policy';
import { validatePassword, type PasswordContext } from './policy';

/**
 * System-generated temporary passwords for account creation and manager reset.
 *
 * The manager never chooses these. A manager-chosen temporary password tends to
 * be weak, reused across staff, and would have to travel through Next's request
 * handling; a generated one avoids all three. It is shown once and never
 * stored in plain text, audited or logged.
 *
 * 20 characters over 56 symbols is 20 * log2(56) ~= 116 bits.
 */

/**
 * `crypto.randomInt` performs rejection sampling internally, so the draw is
 * uniform over the alphabet. Using `% alphabet.length` on raw random bytes
 * would bias towards the first 256 % 56 = 32 symbols.
 */
function randomSymbol(): string {
  const index = randomInt(TEMPORARY_PASSWORD_ALPHABET.length);
  return TEMPORARY_PASSWORD_ALPHABET[index] as string;
}

/**
 * A generated password that failed policy would be astronomically unlikely, but
 * it is revalidated anyway so the invariant "every stored hash came from a
 * password that passed `validatePassword`" holds with no exception carved out
 * for the generator. The bound exists so a future policy change that made
 * generation impossible fails loudly instead of hanging.
 */
const MAX_GENERATION_ATTEMPTS = 16;

export function generateTemporaryPassword(context: PasswordContext = {}): string {
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    let candidate = '';
    for (let index = 0; index < TEMPORARY_PASSWORD_LENGTH; index += 1) {
      candidate += randomSymbol();
    }

    if (validatePassword(candidate, context).ok) {
      return candidate;
    }
  }

  throw new Error(
    `Could not generate a temporary password satisfying the current policy in ${MAX_GENERATION_ATTEMPTS} attempts`,
  );
}

/**
 * Presentation only, for a manager transcribing the value by hand. The stored
 * and compared password is always the ungrouped string.
 */
export function formatTemporaryPasswordForDisplay(password: string): string {
  const groups: string[] = [];

  for (let index = 0; index < password.length; index += TEMPORARY_PASSWORD_DISPLAY_GROUP_SIZE) {
    groups.push(password.slice(index, index + TEMPORARY_PASSWORD_DISPLAY_GROUP_SIZE));
  }

  return groups.join('-');
}
