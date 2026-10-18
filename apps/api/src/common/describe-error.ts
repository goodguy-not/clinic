import { EnvConfigError } from '../config/env';
import { AppError } from './app-error';
import { redactSecrets } from './redact';

/**
 * What may be logged about an error nobody expected: its KIND, never its words.
 *
 * Milestone 10, checkpoint A3 — the logging rule. Production logs carry no
 * personal data, no request bodies, no photo descriptions or file names and no
 * session tokens. `redactSecrets` removes credentials it can recognise; it
 * cannot recognise a family's name. And an unexpected error's MESSAGE is exactly
 * where one turns up:
 *
 *   * PostgreSQL puts row values in its errors — "Failing row contains (…)",
 *     "Key (mobile)=(…) already exists" — and the driver passes them on;
 *   * Prisma renders the arguments of a failed call into its message;
 *   * a JSON parse error quotes the body it could not parse;
 *   * a filesystem error names the path, and a media path is not a secret but
 *     is also nobody's business in a log.
 *
 * So the message is NEVER used, whatever the error. What is kept is enough to
 * find the fault without it: the class name, the driver's error code, the
 * SQLSTATE, the name of the constraint that refused (a schema identifier, never
 * a value), a filesystem errno — and, separately, the stack FRAMES, which are
 * file names and line numbers from this code base. The request id the envelope
 * carries joins the log line to the audit row, which is where the facts are.
 *
 * `AppError` and `EnvConfigError` are the exceptions: the first is a fixed
 * developer sentence written in this repository, the second names environment
 * variables and never their values. Neither is ever built from input.
 */
export function describeError(error: unknown): string {
  if (error instanceof AppError) return `AppError code=${error.code} ${error.message}`;
  if (error instanceof EnvConfigError) return error.message;

  if (!(error instanceof Error)) return `non-error value (${typeof error})`;

  const parts = [safeName(error.name)];
  const record = error as Error & { code?: unknown; errno?: unknown; meta?: unknown };

  if (typeof record.code === 'string' && SAFE_CODE.test(record.code)) {
    parts.push(`code=${record.code}`);
  }

  const meta = record.meta as { code?: unknown; message?: unknown } | undefined;
  if (meta !== undefined && meta !== null && typeof meta === 'object') {
    if (typeof meta.code === 'string' && SQLSTATE.test(meta.code))
      parts.push(`sqlstate=${meta.code}`);
  }

  // The constraint's NAME, read out of the text and kept only if it has the
  // shape of an identifier. The text itself is discarded.
  const constraint = CONSTRAINT.exec(`${String(meta?.message ?? '')}\n${error.message}`)?.[1];
  if (constraint !== undefined) parts.push(`constraint=${constraint}`);

  return parts.join(' ');
}

/** The `at …` lines of a stack, without the message line(s) above them. */
export function stackFrames(error: unknown): string | undefined {
  if (!(error instanceof Error) || error.stack === undefined) return undefined;

  const frames = error.stack
    .split('\n')
    .filter((line) => /^\s+at\s/.test(line))
    .slice(0, MAX_FRAMES);

  return frames.length === 0 ? undefined : redactSecrets(frames.join('\n'));
}

const MAX_FRAMES = 15;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{1,40}$|^P\d{4}$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;
const CONSTRAINT = /constraint "([a-z][a-z0-9_]{0,62})"/;

function safeName(name: string): string {
  return /^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(name) ? name : 'Error';
}
