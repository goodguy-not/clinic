import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { promiseListQuerySchema, type PromiseListQuery } from '@clinic/contracts';
import { AppHeader } from '@/components/app-header';
import { FamilyFinancialPositionPanel } from '@/components/family-financial-position';
import { FamilyMoneyNavigation } from '@/components/family-money-navigation';
import { Alert, PageHeader, PageShell } from '@/components/ui';
import { api } from '@/server/api-client';
import { readCsrfCookie, readSessionToken, requireSession } from '@/server/auth-session';
import { clinicToday } from '@/server/clinic-time';
import { COPY } from '@/server/copy-fa';
import { persianMessage } from '@/server/errors-fa';
import { isKnownErrorCode } from '@/server/handler-support';
import { isoDateToJalali } from '@/server/jalali';
import { PromiseEntryPanel } from './promise-entry';
import { PromiseWorkflow } from './promise-workflow';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function FamilyPromisesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession({ requirePermission: 'promise.read' });
  const [{ id }, rawQuery, token, csrfToken] = await Promise.all([
    params,
    searchParams,
    readSessionToken(),
    readCsrfCookie(),
  ]);
  const query = parsePromiseQuery(rawQuery);
  const context = { sessionToken: token ?? undefined };
  const [familyResult, accountResult, promisesResult, paymentsResult] = await Promise.all([
    api.getFamily(id, context),
    api.getFamilyAccount(id, { page: 1, pageSize: 1, includeVoided: true }, context),
    api.listPromises(id, query, context),
    api.listPayments(id, { page: 1, pageSize: 100, includeVoided: true }, context),
  ]);

  for (const result of [familyResult, accountResult, promisesResult, paymentsResult]) {
    if (!result.ok && result.code === 'FAMILY_NOT_FOUND') notFound();
    if (!result.ok) throw new Error(`Failed to load family promise workflow: ${result.code}`);
  }
  if (!familyResult.ok || !accountResult.ok || !promisesResult.ok || !paymentsResult.ok)
    return null;

  const rawError = typeof rawQuery['error'] === 'string' ? rawQuery['error'] : null;
  const rawSuccess = typeof rawQuery['success'] === 'string' ? rawQuery['success'] : '';
  const successes: Record<string, string> = {
    'promise-created': COPY.promiseCreatedSuccess,
    'promise-fulfilled': COPY.promiseFulfilledSuccess,
    'promise-rescheduled': COPY.promiseRescheduledSuccess,
    'promise-cancelled': COPY.promiseCancelledSuccess,
  };
  const today = clinicToday();
  const todayJalali = isoDateToJalali(today)!;

  return (
    <>
      <AppHeader />
      <PageShell wide>
        <PageHeader
          title={`${COPY.promisePageTitle} · ${familyResult.data.family.familyName}`}
          description={COPY.promisePageDescription}
          backHref={`/families/${id}/account`}
          backLabel="بازگشت به حساب خانواده"
        />
        {isKnownErrorCode(rawError) ? <Alert>{persianMessage(rawError)}</Alert> : null}
        {successes[rawSuccess] !== undefined ? (
          <Alert tone="info">{successes[rawSuccess]}</Alert>
        ) : null}
        <FamilyFinancialPositionPanel position={accountResult.data.position} />
        <FamilyMoneyNavigation familyId={id} active="promises" />
        {user.permissions.includes('promise.create') ? (
          <PromiseEntryPanel
            familyId={id}
            csrfToken={csrfToken ?? ''}
            clinicTodayJalali={todayJalali}
          />
        ) : null}
        <PromiseWorkflow
          familyId={id}
          result={promisesResult.data}
          query={query}
          payments={paymentsResult.data.payments}
          csrfToken={csrfToken ?? ''}
          canResolve={user.permissions.includes('promise.resolve')}
          clinicTodayJalali={todayJalali}
        />
      </PageShell>
    </>
  );
}

export function parsePromiseQuery(
  raw: Record<string, string | string[] | undefined>,
): PromiseListQuery {
  const single = (key: string): string | undefined => {
    const value = raw[key];
    return typeof value === 'string' && value !== '' ? value : undefined;
  };
  const parsed = promiseListQuerySchema.safeParse({
    page: single('page'),
    pageSize: single('pageSize'),
    status: single('status'),
  });
  return parsed.success ? parsed.data : promiseListQuerySchema.parse({ page: 1, pageSize: 25 });
}
