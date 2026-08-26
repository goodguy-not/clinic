import type { Metadata } from 'next';
import { api } from '@/server/api-client';
import {
  callerContext,
  readCsrfCookie,
  readSessionToken,
  requireSession,
} from '@/server/auth-session';
import { persianMessage } from '@/server/errors-fa';
import { isKnownErrorCode } from '@/server/handler-support';
import { TherapistForm } from '../therapist-form';
import { AppHeader } from '@/components/app-header';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function NewTherapistPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession({ requirePermission: 'therapist.create' });

  const token = await readSessionToken();
  const services = await api.listServices(await callerContext(token ?? undefined));

  const params = await searchParams;
  const rawError = params['error'];
  const code = typeof rawError === 'string' ? rawError : null;

  return (
    <>
      <AppHeader />
      <TherapistForm
        services={services.ok ? services.data.services : []}
        csrfToken={(await readCsrfCookie()) ?? ''}
        errorMessage={isKnownErrorCode(code) ? persianMessage(code) : null}
      />
    </>
  );
}
