import { redirect } from 'next/navigation';
import { isKnownErrorCode } from '@/server/handler-support';
import { persianMessage } from '@/server/errors-fa';
import { readCsrfCookie, readOptionalSession, readSessionToken } from '@/server/auth-session';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

/**
 * Sign-in page.
 *
 * `proxy.ts` guarantees a CSRF cookie exists before this renders, which is the
 * only reason the hidden field can match it: a Server Component cannot set a
 * cookie, so the pair has to be established by the redirect that precedes this
 * request.
 *
 * A visitor already holding a session is sent onward rather than shown a form.
 * If that session turns out to be stale, they go to `/session-expired`, which
 * has the form that can actually clear the cookie — this page cannot, and must
 * not try.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sessionToken = await readSessionToken();

  if (sessionToken !== null) {
    const user = await readOptionalSession();

    // Valid session: nothing to do here. Stale or forged: only a POST handler
    // can clear the cookie, so send them where that form lives.
    redirect(user === null ? '/session-expired' : '/');
  }

  const csrfToken = (await readCsrfCookie()) ?? '';
  const params = await searchParams;
  const rawError = params['error'];
  const code = typeof rawError === 'string' ? rawError : null;

  // Validated against the contract's own list before rendering, so the query
  // parameter cannot inject text into the page.
  const errorMessage = isKnownErrorCode(code) ? persianMessage(code) : null;

  return <LoginForm csrfToken={csrfToken} errorMessage={errorMessage} />;
}
