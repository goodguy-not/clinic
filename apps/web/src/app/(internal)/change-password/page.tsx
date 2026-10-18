import { readCsrfCookie, requireSession } from '@/server/auth-session';
import { persianMessage } from '@/server/errors-fa';
import { isKnownErrorCode } from '@/server/handler-support';
import { ChangePasswordForm } from './change-password-form';

export const dynamic = 'force-dynamic';

/**
 * Reachable while a password change is outstanding — it is the page that clears
 * that state, so `allowPasswordChangePending` is set here and nowhere else.
 * NestJS enforces the same rule on every other route regardless.
 */
export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession({ allowPasswordChangePending: true });

  const csrfToken = (await readCsrfCookie()) ?? '';
  const params = await searchParams;
  const rawError = params['error'];
  const code = typeof rawError === 'string' ? rawError : null;

  return (
    <ChangePasswordForm
      csrfToken={csrfToken}
      errorMessage={isKnownErrorCode(code) ? persianMessage(code) : null}
      forced={user.mustChangePassword}
    />
  );
}
