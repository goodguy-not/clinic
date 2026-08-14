import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { familyAccountQuerySchema, type FamilyAccountQuery } from '@clinic/contracts';
import { AppHeader } from '@/components/app-header';
import { PageHeader, PageShell } from '@/components/ui';
import { api } from '@/server/api-client';
import { readSessionToken, requireSession } from '@/server/auth-session';
import { COPY } from '@/server/copy-fa';
import { FamilyAccountView } from './account-view';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function FamilyAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession({ requirePermission: 'charge.read' });
  const [{ id }, rawQuery, token] = await Promise.all([params, searchParams, readSessionToken()]);
  const query = parseAccountQuery(rawQuery);
  const context = { sessionToken: token ?? undefined };
  const [familyResult, accountResult] = await Promise.all([
    api.getFamily(id, context),
    api.getFamilyAccount(id, query, context),
  ]);

  if (!familyResult.ok) {
    if (familyResult.code === 'FAMILY_NOT_FOUND') notFound();
    throw new Error(`Failed to load family: ${familyResult.code}`);
  }
  if (!accountResult.ok) {
    if (accountResult.code === 'FAMILY_NOT_FOUND') notFound();
    throw new Error(`Failed to load family account: ${accountResult.code}`);
  }

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
        <FamilyAccountView
          familyId={id}
          children={familyResult.data.children}
          account={accountResult.data}
          query={query}
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
