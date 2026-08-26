import type { Metadata } from 'next';
import { DASHBOARD_READ_PERMISSIONS, type DashboardResponse } from '@clinic/contracts';
import { Alert, ButtonLink, PageHeader, PageShell } from '@/components/ui';
import { api } from '@/server/api-client';
import { callerContext, readSessionToken, requireSession } from '@/server/auth-session';
import { COPY } from '@/server/copy-fa';
import { AppHeader } from '@/components/app-header';
import { DashboardView } from './dashboard-view';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The signed-in landing page: one server-aggregated view of the clinic day.
 *
 * Protected: `requireSession` redirects an anonymous or stale visitor to
 * `/session-expired`, and anyone owing a password change to
 * `/change-password`. The shared dashboard permission list is required as an
 * AND gate in the page and the API. NestJS decides which financial response
 * variant is returned; this page does not infer authority from the user role.
 */
export default async function Home() {
  await requireSession({ requirePermission: DASHBOARD_READ_PERMISSIONS });
  const token = await readSessionToken();
  let dashboard: DashboardResponse | null = null;

  try {
    const result = await api.dashboard({}, await callerContext(token ?? undefined));
    dashboard = result.ok ? result.data : null;
  } catch {
    // A malformed success must fail closed just like an unavailable endpoint:
    // no partial dashboard is safer than rendering a response outside C1.
  }

  return (
    <>
      <AppHeader />
      {dashboard !== null ? (
        <DashboardView dashboard={dashboard} />
      ) : (
        <PageShell>
          <PageHeader title={COPY.dashboardTitle} description={COPY.homeWelcome} />
          <Alert>{COPY.dashboardLoadFailure}</Alert>
          <div>
            <ButtonLink href="/dashboard" tone="secondary">
              {COPY.dashboardRetry}
            </ButtonLink>
          </div>
        </PageShell>
      )}
    </>
  );
}
