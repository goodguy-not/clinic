import Link from 'next/link';
import { FOCUS_RING, PageHeader, PageShell } from '@/components/ui';
import { requireSession } from '@/server/auth-session';
import { COPY } from '@/server/copy-fa';
import { AppHeader } from '@/components/app-header';

export const dynamic = 'force-dynamic';

/**
 * The signed-in landing page: a dashboard of the surfaces this user may open.
 *
 * Protected: `requireSession` redirects an anonymous or stale visitor to
 * `/session-expired`, and anyone owing a password change to
 * `/change-password`. Cards are rendered from the permission list NestJS
 * resolved for this request — a receptionist holds none of the management
 * permissions, so those cards simply do not appear (and the API would refuse
 * them anyway). Sign-out lives in the app header, on every page.
 */
export default async function Home() {
  const user = await requireSession();

  const sections: { href: string; title: string; description?: string }[] = [];
  if (user.permissions.includes('family.read')) {
    sections.push({
      href: '/families',
      title: COPY.familiesTitle,
      description: COPY.familiesDescription,
    });
  }
  if (user.permissions.includes('service.read')) {
    sections.push({
      href: '/services',
      title: COPY.servicesTitle,
      description: COPY.servicesDescription,
    });
  }
  if (user.permissions.includes('room.read')) {
    sections.push({
      href: '/rooms',
      title: COPY.roomsTitle,
      description: COPY.roomsDescription,
    });
  }
  if (user.permissions.includes('therapist.read')) {
    sections.push({
      href: '/therapists',
      title: COPY.therapistsTitle,
      description: COPY.therapistsDescription,
    });
  }
  if (user.permissions.includes('availability.read')) {
    sections.push({
      href: '/availability',
      title: COPY.availabilityTitle,
      description: COPY.availabilityDescription,
    });
  }
  if (user.permissions.includes('tariff.read')) {
    sections.push({
      href: '/tariffs',
      title: COPY.tariffsTitle,
      description: COPY.tariffsDescription,
    });
  }
  if (user.permissions.includes('user.read')) {
    sections.push({ href: '/staff', title: COPY.staffTitle });
  }

  return (
    <>
      <AppHeader />
      <PageShell>
        <PageHeader title={user.displayName} description={COPY.homeWelcome} />

        <nav aria-label={COPY.menuLabel}>
          <ul className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
            {sections.map((section) => (
              <li key={section.href}>
                <Link
                  href={section.href}
                  className={`flex h-full flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-brand-300 hover:bg-brand-50 ${FOCUS_RING}`}
                >
                  <span className="text-base font-semibold text-slate-900">{section.title}</span>
                  {section.description !== undefined ? (
                    <span className="text-sm text-slate-600">{section.description}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </PageShell>
    </>
  );
}
