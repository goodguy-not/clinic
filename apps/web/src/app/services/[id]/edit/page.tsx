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
import { ServiceForm } from '../../service-form';
import { AppHeader } from '@/components/app-header';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function EditServicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession({ requirePermission: 'service.update' });

  const { id } = await params;
  const token = await readSessionToken();
  const result = await api.getService(id, await callerContext(token ?? undefined));

  // A missing service is a missing page, not an error banner on an empty form.
  if (!result.ok) {
    if (result.code === 'SERVICE_NOT_FOUND') notFound();
    throw new Error(`Failed to load service: ${result.code}`);
  }

  const query = await searchParams;
  const rawError = query['error'];
  const code = typeof rawError === 'string' ? rawError : null;

  return (
    <>
      <AppHeader />
      <ServiceForm
        service={result.data.service}
        csrfToken={(await readCsrfCookie()) ?? ''}
        errorMessage={isKnownErrorCode(code) ? persianMessage(code) : null}
      />
    </>
  );
}
