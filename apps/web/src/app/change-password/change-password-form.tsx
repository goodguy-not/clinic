import { COPY } from '@/server/copy-fa';

/**
 * Pure presentational form.
 *
 * The confirmation field exists only in the web layer, as a typing aid. It is
 * not policy: NestJS never sees it, and every real rule — length in code points,
 * NFC normalisation, blocklists — is enforced there and duplicated nowhere.
 */
export function ChangePasswordForm({
  csrfToken,
  errorMessage,
  forced,
}: {
  csrfToken: string;
  errorMessage: string | null;
  forced: boolean;
}) {
  return (
    <main>
      <h1>{COPY.changePasswordTitle}</h1>

      {forced ? <p className="notice">{COPY.mustChangePassword}</p> : null}

      {errorMessage === null ? null : (
        <p role="alert" className="error">
          {errorMessage}
        </p>
      )}

      <p id="password-guidance" className="guidance">
        {COPY.passwordGuidance}
      </p>

      <form method="post" action="/api/auth/password">
        <input type="hidden" name="csrfToken" value={csrfToken} />

        <p>
          <label htmlFor="currentPassword">{COPY.currentPassword}</label>
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            dir="ltr"
          />
        </p>

        <p>
          <label htmlFor="newPassword">{COPY.newPassword}</label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            aria-describedby="password-guidance"
            required
            dir="ltr"
          />
        </p>

        <p>
          <label htmlFor="confirmPassword">{COPY.confirmNewPassword}</label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            dir="ltr"
          />
        </p>

        <button type="submit">{COPY.changePasswordSubmit}</button>
      </form>
    </main>
  );
}
