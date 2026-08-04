import { COPY } from '@/server/copy-fa';

/**
 * Pure presentational form, so its markup can be render-tested directly.
 *
 * Deliberately absent: any `onPaste`/`onCopy` handler and any
 * `autocomplete="off"`. Blocking paste is a widespread anti-pattern that stops
 * password managers and pushes people towards short, typeable passwords — the
 * opposite of what a fifteen-character minimum is for. The boundary check fails
 * the build if either ever appears under `apps/web`.
 *
 * There is also no client-side password policy. Length, normalisation and
 * blocklists live in NestJS; duplicating any of them here would create a second
 * rule to drift.
 */
export function LoginForm({
  csrfToken,
  errorMessage,
}: {
  csrfToken: string;
  errorMessage: string | null;
}) {
  return (
    <main>
      <h1>{COPY.loginTitle}</h1>

      {errorMessage === null ? null : (
        <p role="alert" className="error">
          {errorMessage}
        </p>
      )}

      <form method="post" action="/api/auth/login">
        {/* Server-rendered half of the double-submit pair. The cookie holding
            the same value is HttpOnly, so script cannot read either copy. */}
        <input type="hidden" name="csrfToken" value={csrfToken} />

        <p>
          <label htmlFor="username">{COPY.username}</label>
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            required
            dir="ltr"
          />
        </p>

        <p>
          <label htmlFor="password">{COPY.password}</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            dir="ltr"
          />
        </p>

        <button type="submit">{COPY.signIn}</button>
      </form>
    </main>
  );
}
