import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { paymentListQuerySchema, type PaymentListQuery } from '@clinic/contracts';
import { AppHeader } from '@/components/app-header';
import { Alert, PageHeader, PageShell } from '@/components/ui';
import { api } from '@/server/api-client';
import { readCsrfCookie, readSessionToken, requireSession } from '@/server/auth-session';
import { COPY } from '@/server/copy-fa';
import { persianMessage } from '@/server/errors-fa';
import { isKnownErrorCode } from '@/server/handler-support';
import { PaymentHistory } from './payment-history';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function FamilyPaymentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession({ requirePermission: 'payment.read' });
  const [{ id }, rawQuery, token, csrfToken] = await Promise.all([
    params,
    searchParams,
    readSessionToken(),
    readCsrfCookie(),
  ]);
  const query = parsePaymentQuery(rawQuery);
  const context = { sessionToken: token ?? undefined };
  const [familyResult, paymentsResult] = await Promise.all([
    api.getFamily(id, context),
    api.listPayments(id, query, context),
  ]);

  if (!familyResult.ok) {
    if (familyResult.code === 'FAMILY_NOT_FOUND') notFound();
    throw new Error(`Failed to load family: ${familyResult.code}`);
  }
  if (!paymentsResult.ok) {
    if (paymentsResult.code === 'FAMILY_NOT_FOUND') notFound();
    throw new Error(`Failed to load family payments: ${paymentsResult.code}`);
  }

  const rawError = typeof rawQuery['error'] === 'string' ? rawQuery['error'] : null;
  const success = rawQuery['success'] === 'payment-voided';

  return (
    <>
      <AppHeader />
      <PageShell wide>
        <PageHeader
          title={`${COPY.paymentHistoryTitle} · ${familyResult.data.family.familyName}`}
          description={COPY.paymentHistoryDescription}
          backHref={`/families/${id}/account`}
          backLabel="بازگشت به حساب خانواده"
        />
        {isKnownErrorCode(rawError) ? <Alert>{persianMessage(rawError)}</Alert> : null}
        {success ? <Alert tone="info">{COPY.paymentVoidedSuccess}</Alert> : null}
        <PaymentHistory
          familyId={id}
          result={paymentsResult.data}
          query={query}
          csrfToken={csrfToken ?? ''}
          canVoid={user.permissions.includes('payment.void')}
        />
      </PageShell>
    </>
  );
}

export function parsePaymentQuery(
  raw: Record<string, string | string[] | undefined>,
): PaymentListQuery {
  const single = (key: string): string | undefined => {
    const value = raw[key];
    return typeof value === 'string' && value !== '' ? value : undefined;
  };
  const parsed = paymentListQuerySchema.safeParse({
    page: single('page'),
    pageSize: single('pageSize'),
    from: single('from'),
    to: single('to'),
    includeVoided: single('includeVoided'),
  });
  return parsed.success
    ? parsed.data
    : paymentListQuerySchema.parse({ page: 1, pageSize: 25, includeVoided: 'true' });
}
