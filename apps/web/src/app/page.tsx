import Link from 'next/link';
import { requireSession } from '@/server/auth-session';
import { readCsrfCookie } from '@/server/auth-session';
import { COPY } from '@/server/copy-fa';

export const dynamic = 'force-dynamic';

/**
 * The signed-in landing page.
 *
 * Protected: `requireSession` redirects an anonymous or stale visitor to
 * `/session-expired`, and anyone owing a password change to
 * `/change-password`. Sign-out is a form post, not a link — clearing a session
 * cookie is a state change and must not happen on a GET.
 */
export default async function Home() {
  const user = await requireSession();
  const csrfToken = (await readCsrfCookie()) ?? '';
  const canManageStaff = user.permissions.includes('user.read');

  return (
    <main>
      <h1>{user.displayName}</h1>
      <p dir="ltr">{user.username}</p>

      <ul>
        {canManageStaff ? (
          <li>
            <Link href="/staff">{COPY.staffTitle}</Link>
          </li>
        ) : null}
        <li>
          <Link href="/change-password">{COPY.changePasswordTitle}</Link>
        </li>
      </ul>

      <form method="post" action="/api/auth/logout">
        <input type="hidden" name="csrfToken" value={csrfToken} />
        <button type="submit">{COPY.signOut}</button>
      </form>
    </main>
  );
}
