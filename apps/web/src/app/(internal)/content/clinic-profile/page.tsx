import type { Metadata } from 'next';
import { AppHeader } from '@/components/app-header';
import { api } from '@/server/api-client';
import {
  callerContext,
  readCsrfCookie,
  readSessionToken,
  requireSession,
} from '@/server/auth-session';
import { persianMessage } from '@/server/errors-fa';
import { isKnownErrorCode } from '@/server/handler-support';
import { ClinicProfileForm } from './clinic-profile-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ClinicProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession({ requirePermission: ['clinic_profile.read', 'clinic_profile.update'] });
  const token = await readSessionToken();
  const [result, query] = await Promise.all([
    api.getClinicProfile(await callerContext(token ?? undefined)),
    searchParams,
  ]);
  if (!result.ok) throw new Error(`Failed to load clinic profile: ${result.code}`);
  const error = Array.isArray(query['error']) ? query['error'][0] : query['error'];
  const success = Array.isArray(query['success']) ? query['success'][0] : query['success'];
  const message =
    error !== undefined && isKnownErrorCode(error)
      ? persianMessage(error)
      : success === 'saved'
        ? 'مشخصات عمومی کلینیک ذخیره شد.'
        : null;
  return (
    <>
      <AppHeader />
      <ClinicProfileForm
        clinic={result.data.clinic}
        csrfToken={(await readCsrfCookie()) ?? ''}
        message={message}
      />
    </>
  );
}
