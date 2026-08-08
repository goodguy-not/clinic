import type { Metadata } from 'next';
import { readCsrfCookie, requireSession } from '@/server/auth-session';
import { persianMessage } from '@/server/errors-fa';
import { isKnownErrorCode } from '@/server/handler-support';
import { FamilyForm } from '../family-form';
import { AppHeader } from '@/components/app-header';

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

  return (
    <>
      <AppHeader />
      <FamilyForm
        csrfToken={(await readCsrfCookie()) ?? ''}
        errorMessage={isKnownErrorCode(code) ? persianMessage(code) : null}
      />
    </>
  );
}
