/**
 * Masks secret material in text that is about to be logged.
 *
 * Driver errors embed connection URLs in their message or stack; auth code
 * handles Argon2 hashes and opaque session tokens. Any text derived from an
 * error or a request must pass through here first (PROJECT_SPEC.md 13, "no
 * sensitive logs").
 *
 * This is applied structurally, not by convention: `ErrorEnvelopeFilter` routes
 * every logged error message and stack through `redactSecrets`, and
 * `security-log.ts` builds its lines from an allowlist of fields rather than
 * from arbitrary request data.
 */

/** `postgresql://user:password@host` -> `postgresql://user:***@host` */
const CONNECTION_STRING_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/[^:@\s/]+:)[^@\s]+(@)/gi;

/**
 * A full Argon2 encoded hash. The salt and digest segments are replaced but the
 * parameter prefix is kept, because knowing which cost parameters produced a
 * hash is useful in a log and reveals nothing.
 */
const ARGON2_HASH =
  /(\$argon2(?:id|i|d)\$v=\d+\$m=\d+,t=\d+,p=\d+\$)[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+/g;

/** Any remaining `$argon2...` fragment, including a truncated or malformed one. */
const ARGON2_FRAGMENT = /\$argon2[a-z]*\$[^\s"']*/gi;

/**
 * Header-ish or JSON-ish assignments of a named secret.
 *
 * `x-draft-token` and `draftToken` are here for the same reason `x-session-id`
 * is: a registration-draft token is a bearer credential. Anyone holding one can
 * read the family details somebody typed and complete their registration, so it
 * is a secret in every sense that matters, even though the row it addresses
 * lives for ten minutes.
 */
const NAMED_SECRET_ASSIGNMENT =
  /\b(x-internal-key|x-session-id|x-draft-token|internal[_-]?key|session[_-]?token|draft[_-]?token|api[_-]?key|authorization|cookie|password)\b(\s*[:=]\s*)("?)([^\s",;}]+)\3/gi;

export function redactSecrets(text: string): string {
  return text
    .replace(CONNECTION_STRING_CREDENTIALS, '$1***$2')
    .replace(ARGON2_HASH, '$1***')
    .replace(ARGON2_FRAGMENT, '$argon2***')
    .replace(NAMED_SECRET_ASSIGNMENT, (_match, name: string, sep: string, quote: string) => {
      return `${name}${sep}${quote}***${quote}`;
    });
}

/**
 * Redacts an unknown thrown value for logging. Returns message and stack
 * separately because the filter logs them separately.
 */
export function redactError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: redactSecrets(error.message),
      ...(error.stack === undefined ? {} : { stack: redactSecrets(error.stack) }),
    };
  }

  return { message: redactSecrets(String(error)) };
}
