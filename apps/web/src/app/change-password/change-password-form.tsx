import { Alert, AuthShell, Field, SubmitButton } from '@/components/ui';
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
    <AuthShell title={COPY.changePasswordTitle}>
      {forced ? <Alert tone="info">{COPY.mustChangePassword}</Alert> : null}

      {errorMessage === null ? null : <Alert>{errorMessage}</Alert>}

      <p
        id="password-guidance"
        className="rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-700"
      >
        {COPY.passwordGuidance}
      </p>

      <form method="post" action="/api/auth/password" className="flex flex-col gap-4">
        <input type="hidden" name="csrfToken" value={csrfToken} />

        <Field id="currentPassword" label={COPY.currentPassword} required>
          {(props) => (
            <input
              {...props}
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              dir="ltr"
              className={`${props.className} text-start`}
            />
          )}
        </Field>

        <Field id="newPassword" label={COPY.newPassword} required>
          {(props) => (
            <input
              {...props}
              name="newPassword"
              type="password"
              autoComplete="new-password"
              aria-describedby="password-guidance"
              required
              dir="ltr"
              className={`${props.className} text-start`}
            />
          )}
        </Field>

        <Field id="confirmPassword" label={COPY.confirmNewPassword} required>
          {(props) => (
            <input
              {...props}
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              dir="ltr"
              className={`${props.className} text-start`}
            />
          )}
        </Field>

        <div className="flex flex-col pt-2">
          <SubmitButton>{COPY.changePasswordSubmit}</SubmitButton>
        </div>
      </form>
    </AuthShell>
  );
}
