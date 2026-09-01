import type { Metadata } from 'next';
import { WEBSITE_REQUEST_LINK_PERMISSIONS } from '@clinic/contracts';
import { AppHeader } from '@/components/app-header';
import { Alert, ButtonLink, PageHeader, PageShell } from '@/components/ui';
import { api } from '@/server/api-client';
import {
  callerContext,
  readCsrfCookie,
  readSessionToken,
  requireSession,
} from '@/server/auth-session';
import { persianMessage } from '@/server/errors-fa';
import { isKnownErrorCode } from '@/server/handler-support';
import { isKnownNoticeCode, persianNotice } from '@/server/notices';
import { WebsiteRequestDetailView } from '../website-request-detail';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function WebsiteRequestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession({ requirePermission: 'website_request.read' });
  const { id } = await params;
  const token = await readSessionToken();
  const result = await api.getWebsiteRequest(id, await callerContext(token ?? undefined));

  if (!result.ok) {
    return (
      <>
        <AppHeader />
        <PageShell>
          <PageHeader
            title="جزئیات درخواست ارزیابی"
            backHref="/website-requests"
            backLabel="بازگشت به درخواست‌ها"
          />
          <Alert>{persianMessage(result.code)}</Alert>
          <ButtonLink href="/website-requests" tone="secondary">
            بازگشت
          </ButtonLink>
        </PageShell>
      </>
    );
  }

  const query = await searchParams;
  const rawError = Array.isArray(query['error']) ? query['error'][0] : query['error'];
  const outcome = Array.isArray(query['outcome']) ? query['outcome'][0] : query['outcome'];
  const rawNotice = Array.isArray(query['notice']) ? query['notice'][0] : query['notice'];
  const has = (permission: (typeof user.permissions)[number]) =>
    user.permissions.includes(permission);
  const canLink = WEBSITE_REQUEST_LINK_PERMISSIONS.every(has);

  return (
    <>
      <AppHeader />
      <WebsiteRequestDetailView
        request={result.data}
        csrfToken={(await readCsrfCookie()) ?? ''}
        canProcess={has('website_request.process')}
        canLink={canLink}
        canCreateFamily={canLink && has('family.create')}
        errorMessage={
          typeof rawError === 'string' && isKnownErrorCode(rawError)
            ? persianMessage(rawError)
            : null
        }
        successMessage={
          outcome === 'linked'
            ? `درخواست با موفقیت به خانواده پیوند خورد و تبدیل شد.${typeof rawNotice === 'string' && isKnownNoticeCode(rawNotice) ? ` ${persianNotice(rawNotice)}` : ''}`
            : outcome === 'status-updated'
              ? 'وضعیت درخواست با موفقیت به‌روز شد.'
              : null
        }
      />
    </>
  );
}
