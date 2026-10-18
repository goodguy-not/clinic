import type { Metadata } from 'next';
import { WEBSITE_REQUEST_STATUSES, type WebsiteRequestStatus } from '@clinic/contracts';
import { Alert, ButtonLink, PageHeader, PageShell } from '@/components/ui';
import { AppHeader } from '@/components/app-header';
import { api } from '@/server/api-client';
import { callerContext, readSessionToken, requireSession } from '@/server/auth-session';
import { WebsiteRequestInbox } from './website-request-inbox';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

function selectedStatuses(value: string | string[] | undefined): WebsiteRequestStatus[] {
  const values = value === undefined ? [] : Array.isArray(value) ? value : [value];
  return values.filter((status): status is WebsiteRequestStatus =>
    (WEBSITE_REQUEST_STATUSES as readonly string[]).includes(status),
  );
}

export default async function WebsiteRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession({ requirePermission: 'website_request.read' });
  const params = await searchParams;
  const statuses = selectedStatuses(params['statuses']);
  const rawPage = Array.isArray(params['page']) ? params['page'][0] : params['page'];
  const page = /^\d+$/.test(rawPage ?? '') ? Math.max(1, Number(rawPage)) : 1;
  const token = await readSessionToken();
  const result = await api.websiteRequestInbox(
    { ...(statuses.length > 0 ? { statuses } : {}), page, pageSize: 25 },
    await callerContext(token ?? undefined),
  );

  return (
    <>
      <AppHeader />
      {result.ok ? (
        <WebsiteRequestInbox inbox={result.data} selectedStatuses={statuses} />
      ) : (
        <PageShell>
          <PageHeader title="درخواست‌های ارزیابی وب‌سایت" />
          <Alert>بارگذاری درخواست‌ها ممکن نشد. دوباره تلاش کنید.</Alert>
          <ButtonLink href="/website-requests" tone="secondary">
            تلاش دوباره
          </ButtonLink>
        </PageShell>
      )}
    </>
  );
}
