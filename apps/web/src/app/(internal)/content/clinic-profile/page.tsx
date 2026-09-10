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
import { ClinicContentEditor } from './clinic-content-editor';
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
  const context = await callerContext(token ?? undefined);
  const [result, contentResult, mediaResult, query] = await Promise.all([
    api.getClinicProfile(context),
    api.listClinicContentEntries(context),
    api.listMedia(context),
    searchParams,
  ]);
  if (!result.ok) throw new Error(`Failed to load clinic profile: ${result.code}`);
  if (!contentResult.ok) throw new Error(`Failed to load clinic content: ${contentResult.code}`);
  const error = Array.isArray(query['error']) ? query['error'][0] : query['error'];
  const success = Array.isArray(query['success']) ? query['success'][0] : query['success'];
  const message =
    error !== undefined && isKnownErrorCode(error)
      ? persianMessage(error)
      : success === 'saved'
        ? 'مشخصات عمومی کلینیک ذخیره شد.'
        : success === 'entry-saved'
          ? 'محتوای این بخش ذخیره و روی سایت به‌روز شد.'
          : success === 'image-published'
            ? 'عکس انتخاب‌شده منتشر شد.'
            : success === 'image-withdrawn'
              ? 'عکس انتخاب‌شده از سایت برداشته شد.'
              : null;
  const csrfToken = (await readCsrfCookie()) ?? '';
  return (
    <>
      <AppHeader />
      <ClinicProfileForm clinic={result.data.clinic} csrfToken={csrfToken} message={message} />
      <ClinicContentEditor
        entries={contentResult.data.entries}
        media={mediaResult.ok ? mediaResult.data.media : []}
        csrfToken={csrfToken}
        mediaLoadError={mediaResult.ok ? null : persianMessage(mediaResult.code)}
      />
    </>
  );
}
