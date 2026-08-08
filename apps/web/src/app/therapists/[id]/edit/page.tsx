import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { api } from '@/server/api-client';
import {
  callerContext,
  readCsrfCookie,
  readSessionToken,
  requireSession,
} from '@/server/auth-session';
import { persianMessage } from '@/server/errors-fa';
import { isKnownErrorCode } from '@/server/handler-support';
import { TherapistForm } from '../../therapist-form';
import { AppHeader } from '@/components/app-header';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function EditTherapistPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession({ requirePermission: 'therapist.update' });

  const { id } = await params;
  const token = await readSessionToken();
  const context = await callerContext(token ?? undefined);

  const [therapist, services] = await Promise.all([
    api.getTherapist(id, context),
    api.listServices(context),
  ]);

  // A missing therapist is a missing page, not an error banner on an empty form.
  if (!therapist.ok) {
    if (therapist.code === 'THERAPIST_NOT_FOUND') notFound();
    throw new Error(`Failed to load therapist: ${therapist.code}`);
  }

  const query = await searchParams;
  const rawError = query['error'];
  const code = typeof rawError === 'string' ? rawError : null;

  return (
    <>
      <AppHeader />
      <TherapistForm
        therapist={therapist.data.therapist}
        services={services.ok ? services.data.services : []}
        csrfToken={(await readCsrfCookie()) ?? ''}
        errorMessage={isKnownErrorCode(code) ? persianMessage(code) : null}
      />
    </>
  );
}
