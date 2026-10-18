import type { Metadata } from 'next';
import {
  WEBSITE_REQUEST_LEGAL_TRANSITIONS,
  WEBSITE_REQUEST_LINK_PERMISSIONS,
  type WebsiteRequestDetail,
} from '@clinic/contracts';
import { api } from '@/server/api-client';
import {
  callerContext,
  readCsrfCookie,
  readSessionToken,
  requireSession,
} from '@/server/auth-session';
import { persianMessage } from '@/server/errors-fa';
import { isKnownErrorCode } from '@/server/handler-support';
import { FamilyForm } from '../family-form';
import { AppHeader } from '@/components/app-header';
import { Alert, ButtonLink, PageHeader, PageShell } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function NewFamilyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession({ requirePermission: 'family.create' });

  const params = await searchParams;
  const rawError = params['error'];
  const code = typeof rawError === 'string' ? rawError : null;
  const rawRequestId = params['fromWebsiteRequest'];
  const requestId = typeof rawRequestId === 'string' ? rawRequestId : null;
  let websiteRequest: Extract<WebsiteRequestDetail, { contentPurged: false }> | undefined;
  let sourceError: string | null = null;

  if (requestId !== null) {
    await requireSession({
      requirePermission: [
        'family.create',
        'website_request.read',
        ...WEBSITE_REQUEST_LINK_PERMISSIONS,
      ],
    });
    const token = await readSessionToken();
    const result = await api.getWebsiteRequest(requestId, await callerContext(token ?? undefined));
    if (!result.ok) {
      sourceError = persianMessage(result.code);
    } else if (
      result.ok &&
      !result.data.contentPurged &&
      result.data.linkedFamily === null &&
      WEBSITE_REQUEST_LEGAL_TRANSITIONS[result.data.status].includes('CONVERTED_TO_FAMILY')
    ) {
      websiteRequest = result.data;
    } else {
      sourceError = 'این درخواست دیگر برای تبدیل به خانواده در دسترس نیست.';
    }
  }

  if (sourceError !== null) {
    return (
      <>
        <AppHeader />
        <PageShell>
          <PageHeader
            title="ثبت خانواده از درخواست وب‌سایت"
            backHref={requestId === null ? '/website-requests' : `/website-requests/${requestId}`}
            backLabel="بازگشت به درخواست"
          />
          <Alert>{sourceError}</Alert>
          <ButtonLink href="/website-requests" tone="secondary">
            بازگشت به درخواست‌ها
          </ButtonLink>
        </PageShell>
      </>
    );
  }

  return (
    <>
      <AppHeader />
      <FamilyForm
        csrfToken={(await readCsrfCookie()) ?? ''}
        errorMessage={isKnownErrorCode(code) ? persianMessage(code) : null}
        websiteRequest={websiteRequest}
      />
    </>
  );
}
