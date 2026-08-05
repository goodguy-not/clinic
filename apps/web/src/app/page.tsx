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
  const canManageServices = user.permissions.includes('service.read');
  const canManageRooms = user.permissions.includes('room.read');
  const canManageTherapists = user.permissions.includes('therapist.read');
  const canManageTariffs = user.permissions.includes('tariff.read');

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
        {/*
          Rendered from the permission list NestJS resolved for this request. A
          receptionist holds none of these in Milestone 2, so the links simply
          do not appear — and the API would refuse them anyway.
        */}
        {canManageServices ? (
          <li>
            <Link href="/services">{COPY.servicesTitle}</Link>
          </li>
        ) : null}
        {canManageRooms ? (
          <li>
            <Link href="/rooms">{COPY.roomsTitle}</Link>
          </li>
        ) : null}
        {canManageTherapists ? (
          <li>
            <Link href="/therapists">{COPY.therapistsTitle}</Link>
          </li>
        ) : null}
        {canManageTariffs ? (
          <li>
            <Link href="/tariffs">{COPY.tariffsTitle}</Link>
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
