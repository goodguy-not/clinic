import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { api } from '@/server/api-client';
import { readCsrfCookie, readSessionToken, requireSession } from '@/server/auth-session';
import { persianMessage } from '@/server/errors-fa';
import { isKnownErrorCode } from '@/server/handler-support';
import { ChildForm } from '../../../../children/child-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function NewChildPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession({ requirePermission: 'child.create' });

  const { id } = await params;
  const token = await readSessionToken();
  const result = await api.getFamily(id, { sessionToken: token ?? undefined });

  if (!result.ok) {
    if (result.code === 'FAMILY_NOT_FOUND') notFound();
    throw new Error(`Failed to load family: ${result.code}`);
  }

  const query = await searchParams;
  const rawError = query['error'];
  const code = typeof rawError === 'string' ? rawError : null;

  return (
    <ChildForm
      family={result.data.family}
      csrfToken={(await readCsrfCookie()) ?? ''}
      errorMessage={isKnownErrorCode(code) ? persianMessage(code) : null}
    />
  );
}
