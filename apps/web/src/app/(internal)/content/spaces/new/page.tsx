import type { Metadata } from 'next';
import { AppHeader } from '@/components/app-header';
import { readCsrfCookie, requireSession } from '@/server/auth-session';
import { persianMessage } from '@/server/errors-fa';
import { isKnownErrorCode } from '@/server/handler-support';
import { firstQueryValue } from '../presentation';
import { SpaceForm } from '../space-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function NewSpacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession({ requirePermission: 'public_space.draft' });
  const errorCode = firstQueryValue((await searchParams)['error']);

  return (
    <>
      <AppHeader />
      <SpaceForm
        csrfToken={(await readCsrfCookie()) ?? ''}
        errorMessage={errorCode && isKnownErrorCode(errorCode) ? persianMessage(errorCode) : null}
      />
    </>
  );
}
