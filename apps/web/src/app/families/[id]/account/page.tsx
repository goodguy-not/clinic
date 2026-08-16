import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { familyAccountQuerySchema, type FamilyAccountQuery } from '@clinic/contracts';
import { AppHeader } from '@/components/app-header';
import { Alert, PageHeader, PageShell } from '@/components/ui';
import { api } from '@/server/api-client';
import { readCsrfCookie, readSessionToken, requireSession } from '@/server/auth-session';
import { COPY } from '@/server/copy-fa';
import { persianMessage } from '@/server/errors-fa';
import { isKnownErrorCode } from '@/server/handler-support';
import { FamilyAccountView } from './account-view';
import { clinicToday } from '@/server/clinic-time';
import { isoDateToJalali } from '@/server/jalali';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function FamilyAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession({ requirePermission: 'charge.read' });
  const [{ id }, rawQuery, token] = await Promise.all([params, searchParams, readSessionToken()]);
  const query = parseAccountQuery(rawQuery);
  const context = { sessionToken: token ?? undefined };
  const today = clinicToday();
  const [familyResult, accountResult, recentPaymentsResult] = await Promise.all([
    api.getFamily(id, context),
    api.getFamilyAccount(id, query, context),
    api.listPayments(id, { page: 1, pageSize: 5, includeVoided: true }, context),
  ]);

  if (!familyResult.ok) {
    if (familyResult.code === 'FAMILY_NOT_FOUND') notFound();
    throw new Error(`Failed to load family: ${familyResult.code}`);
  }
  if (!accountResult.ok) {
    if (accountResult.code === 'FAMILY_NOT_FOUND') notFound();
    throw new Error(`Failed to load family account: ${accountResult.code}`);
  }
  if (!recentPaymentsResult.ok) {
    if (recentPaymentsResult.code === 'FAMILY_NOT_FOUND') notFound();
    throw new Error(`Failed to load recent family payments: ${recentPaymentsResult.code}`);
  }

  const rawError = typeof rawQuery['error'] === 'string' ? rawQuery['error'] : null;
  const rawSuccess = typeof rawQuery['success'] === 'string' ? rawQuery['success'] : '';
  const successes: Record<string, string> = {
    'charge-voided': COPY.familyAccountChargeVoidedSuccess,
    'adjustment-created': COPY.familyAccountAdjustmentCreatedSuccess,
    'adjustment-voided': COPY.familyAccountAdjustmentVoidedSuccess,
    'payment-created': COPY.paymentCreatedSuccess,
  };

  return (
    <>
      <AppHeader />
      <PageShell wide>
        <PageHeader
          title={`${COPY.familyAccountTitle} · ${familyResult.data.family.familyName}`}
          description={COPY.familyAccountDescription}
          backHref={`/families/${id}`}
          backLabel={COPY.back}
        />
        {isKnownErrorCode(rawError) ? <Alert>{persianMessage(rawError)}</Alert> : null}
        {successes[rawSuccess] !== undefined ? (
          <Alert tone="info">{successes[rawSuccess]}</Alert>
        ) : null}
        <FamilyAccountView
          familyId={id}
          children={familyResult.data.children}
          account={accountResult.data}
          query={query}
          csrfToken={(await readCsrfCookie()) ?? ''}
          canAdjustCharge={user.permissions.includes('charge.adjust')}
          canVoidCharge={user.permissions.includes('charge.void')}
          canCreatePayment={user.permissions.includes('payment.create')}
          recentPayments={recentPaymentsResult.data.payments}
          clinicToday={today}
          clinicTodayJalali={isoDateToJalali(today)!}
        />
      </PageShell>
    </>
  );
}

export function parseAccountQuery(
  raw: Record<string, string | string[] | undefined>,
): FamilyAccountQuery {
  const single = (key: string): string | undefined => {
    const value = raw[key];
    return typeof value === 'string' && value !== '' ? value : undefined;
  };
  const candidate = {
    page: single('page'),
    pageSize: single('pageSize'),
    childId: single('childId'),
    from: single('from'),
    to: single('to'),
    includeVoided: single('includeVoided'),
  };
  const parsed = familyAccountQuerySchema.safeParse(candidate);
  return parsed.success
    ? parsed.data
    : familyAccountQuerySchema.parse({ page: 1, pageSize: 25, includeVoided: 'true' });
}
