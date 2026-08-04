import { COPY } from '@/server/copy-fa';

export const dynamic = 'force-dynamic';

/**
 * Stale-session recovery.
 *
 * This page deliberately does **not** call `requireSession()`. It is where an
 * invalid session lands, so checking the session here would bounce the user
 * straight back and loop forever. Not calling it is what makes the chain
 * terminate.
 *
 * The button posts a form. It is not a link and not an automatic redirect,
 * because clearing the session cookie is a state change: `SameSite=Lax` sends
 * cookies on a cross-site top-level GET navigation, so a GET that cleared them
 * would let any page on the internet sign a staff member out.
 */
export default function SessionExpiredPage() {
  return (
    <main>
      <h1>{COPY.sessionExpired}</h1>

      <form method="post" action="/api/auth/session-reset">
        <button type="submit">{COPY.sessionExpiredButton}</button>
      </form>
    </main>
  );
}
