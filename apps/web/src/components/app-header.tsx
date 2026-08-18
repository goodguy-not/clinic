import Link from 'next/link';
import { readCsrfCookie, readOptionalSession } from '@/server/auth-session';
import { COPY } from '@/server/copy-fa';
import { FOCUS_RING } from './styles';

/**
 * The persistent application chrome: brand, primary navigation, and the
 * signed-in user's actions.
 *
 * Rendered once near the top of every authenticated page, by each
 * authenticated page. It resolves the session itself through
 * `readOptionalSession`, so pages never thread the user through purely
 * presentational components; on the anonymous surfaces (login,
 * session-expired) it is simply not rendered.
 *
 * Navigation mirrors the permission list NestJS resolved for this request — a
 * receptionist sees only the surfaces the API would let them use. Sign-out is
 * a form post, not a link: clearing a session cookie is a state change and
 * must not happen on a GET.
 *
 * No client JavaScript: the compact menu is a `<details>` element, keyboard
 * and touch accessible by default.
 */
export async function AppHeader() {
  const user = await readOptionalSession();
  if (user === null) {
    return null;
  }
  const csrfToken = (await readCsrfCookie()) ?? '';

  const links: { href: string; label: string }[] = [];
  links.push({ href: '/', label: COPY.dashboardTitle });
  if (user.permissions.includes('appointment.read')) {
    links.push({ href: '/appointments', label: COPY.appointmentsTitle });
  }
  if (user.permissions.includes('family.read')) {
    links.push({ href: '/families', label: COPY.familiesTitle });
  }
  if (user.permissions.includes('appointment.read')) {
    links.push({ href: '/reports', label: 'گزارش‌ها' });
  }
  if (user.permissions.includes('service.read')) {
    links.push({ href: '/services', label: COPY.servicesTitle });
  }
  if (user.permissions.includes('room.read')) {
    links.push({ href: '/rooms', label: COPY.roomsTitle });
  }
  if (user.permissions.includes('therapist.read')) {
    links.push({ href: '/therapists', label: COPY.therapistsTitle });
  }
  if (user.permissions.includes('availability.read')) {
    links.push({ href: '/availability', label: COPY.availabilityTitle });
  }
  if (user.permissions.includes('tariff.read')) {
    links.push({ href: '/tariffs', label: COPY.tariffsTitle });
  }
  if (user.permissions.includes('user.read')) {
    links.push({ href: '/staff', label: COPY.staffTitle });
  }

  const primaryLinks = links.slice(0, 3);
  const managementLinks = links.slice(3);

  const navLinkClass = `whitespace-nowrap rounded-md px-2.5 py-2 text-sm font-semibold text-slate-700 hover:bg-brand-50 hover:text-brand-900 ${FOCUS_RING}`;

  const userActions = (
    <>
      <Link href="/change-password" className={navLinkClass}>
        {COPY.changePasswordTitle}
      </Link>
      <form method="post" action="/api/auth/logout">
        <input type="hidden" name="csrfToken" value={csrfToken} />
        <button
          type="submit"
          className={`rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 ${FOCUS_RING}`}
        >
          {COPY.signOut}
        </button>
      </form>
    </>
  );

  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-2 px-4 py-2.5 sm:px-6">
        <Link
          href="/"
          className={`flex items-center gap-2 whitespace-nowrap rounded-md px-1 py-1 text-base font-bold text-brand-900 ${FOCUS_RING}`}
        >
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-lg bg-brand-700 text-sm font-bold text-white"
          >
            ک
          </span>
          {COPY.appTitle}
        </Link>

        {/* Wide screens: inline navigation and user actions. */}
        <nav
          aria-label={COPY.menuLabel}
          className="ms-3 hidden min-w-0 items-center gap-0.5 lg:flex"
        >
          {primaryLinks.map((link) => (
            <Link key={link.href} href={link.href} className={navLinkClass}>
              {link.label}
            </Link>
          ))}
          {managementLinks.length > 0 ? (
            <details className="group relative">
              <summary
                className={`flex cursor-pointer list-none items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-2 text-sm font-semibold text-slate-700 hover:bg-brand-50 hover:text-brand-900 [&::-webkit-details-marker]:hidden ${FOCUS_RING}`}
              >
                {COPY.moreSections}
                <span
                  aria-hidden="true"
                  className="text-xs transition-transform group-open:rotate-180"
                >
                  ⌄
                </span>
              </summary>
              <div className="absolute start-0 top-full mt-2 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                {managementLinks.map((link) => (
                  <Link key={link.href} href={link.href} className={`block ${navLinkClass}`}>
                    {link.label}
                  </Link>
                ))}
              </div>
            </details>
          ) : null}
        </nav>
        <div className="ms-auto hidden items-center gap-2 lg:flex">
          <span className="hidden whitespace-nowrap text-sm font-medium text-slate-600 2xl:inline">
            {user.displayName}
          </span>
          {userActions}
        </div>

        {/* Narrow screens: a disclosure menu with the same content. */}
        <details className="group relative ms-auto lg:hidden">
          <summary
            aria-label={COPY.menuLabel}
            className={`flex size-10 cursor-pointer list-none items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 [&::-webkit-details-marker]:hidden ${FOCUS_RING}`}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="size-5"
            >
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          </summary>
          <div className="absolute end-0 top-full mt-2 max-h-[calc(100dvh-5rem)] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
            <nav aria-label={COPY.menuLabel} className="flex flex-col">
              {links.map((link) => (
                <Link key={link.href} href={link.href} className={navLinkClass}>
                  {link.label}
                </Link>
              ))}
            </nav>
            <div className="mt-2 flex flex-col gap-2 border-t border-slate-200 pt-3">
              <span className="px-3 text-sm font-medium text-slate-600">{user.displayName}</span>
              {userActions}
            </div>
          </div>
        </details>
      </div>
    </header>
  );
}
