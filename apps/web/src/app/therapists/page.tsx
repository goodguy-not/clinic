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
import { TherapistList } from './therapist-list';

export const dynamic = 'force-dynamic';

/** Internal administration is never indexed. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function TherapistsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession({ requirePermission: 'therapist.read' });

  const token = await readSessionToken();
  const context = await callerContext(token ?? undefined);

  // Services are fetched so the list can name a therapist's services rather
  // than showing ids. Page-specific aggregation is what the selective BFF is for.
  const [therapists, services] = await Promise.all([
    api.listTherapists(context),
    api.listServices(context),
  ]);

  const params = await searchParams;
  const rawError = params['error'];
  const code = typeof rawError === 'string' ? rawError : null;

  const errorMessage = isKnownErrorCode(code)
    ? persianMessage(code)
    : therapists.ok
      ? null
      : persianMessage(therapists.code);

  return (
    <TherapistList
      therapists={therapists.ok ? therapists.data.therapists : []}
      services={services.ok ? services.data.services : []}
      csrfToken={(await readCsrfCookie()) ?? ''}
      errorMessage={errorMessage}
    />
  );
}
