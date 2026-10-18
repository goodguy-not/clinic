import { Alert, AuthShell, Field, SubmitButton } from '@/components/ui';
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
    <AuthShell title={COPY.loginTitle}>
      {errorMessage === null ? null : <Alert>{errorMessage}</Alert>}

      <form method="post" action="/api/auth/login" className="flex flex-col gap-4">
        {/* Server-rendered half of the double-submit pair. The cookie holding
            the same value is HttpOnly, so script cannot read either copy. */}
        <input type="hidden" name="csrfToken" value={csrfToken} />

        <Field id="username" label={COPY.username} required>
          {(props) => (
            <input
              {...props}
              name="username"
              type="text"
              autoComplete="username"
              required
              dir="ltr"
              className={`${props.className} text-start`}
            />
          )}
        </Field>

        <Field id="password" label={COPY.password} required>
          {(props) => (
            <input
              {...props}
              name="password"
              type="password"
              autoComplete="current-password"
              required
              dir="ltr"
              className={`${props.className} text-start`}
            />
          )}
        </Field>

        <div className="flex flex-col pt-2">
          <SubmitButton>{COPY.signIn}</SubmitButton>
        </div>
      </form>
    </AuthShell>
  );
}
