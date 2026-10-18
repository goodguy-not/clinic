import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
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
import { TherapistProfileEditor } from './therapist-profile-editor';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function TherapistProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession({ requirePermission: 'therapist.draft_public_profile' });
  const { id } = await params;
  const token = await readSessionToken();
  const context = await callerContext(token ?? undefined);
  const canPublish = user.permissions.includes('therapist.publish_profile');
  const [therapistResult, copyResult, profileResult, mediaResult, query] = await Promise.all([
    api.getTherapist(id, context),
    api.getTherapistProfileCopy(id, context),
    canPublish ? api.getTherapistPublicProfile(id, context) : Promise.resolve(null),
    api.listMedia(context),
    searchParams,
  ]);
  if (!therapistResult.ok) {
    if (therapistResult.code === 'THERAPIST_NOT_FOUND') notFound();
    throw new Error(`Failed to load therapist: ${therapistResult.code}`);
  }
  if (!copyResult.ok) {
    if (copyResult.code === 'THERAPIST_NOT_FOUND') notFound();
    throw new Error(`Failed to load therapist copy: ${copyResult.code}`);
  }
  if (profileResult !== null && !profileResult.ok)
    throw new Error(`Failed to load public profile: ${profileResult.code}`);
  const error = Array.isArray(query['error']) ? query['error'][0] : query['error'];
  const success = Array.isArray(query['success']) ? query['success'][0] : query['success'];
  const successMessages: Record<string, string> = {
    'draft-saved': 'متن آماده ذخیره شد؛ نسخهٔ روی سایت تغییر نکرد.',
    'settings-saved': 'تنظیمات نمایه ذخیره شد.',
    published: 'متن آماده تأیید و نمایهٔ عمومی به‌روز شد.',
    withdrawn: 'نمایه از نمایش عمومی برداشته شد.',
    'photo-published': 'عکس این نمایه منتشر شد.',
    'photo-withdrawn': 'عکس این نمایه از سایت برداشته شد.',
  };
  const message =
    error !== undefined && isKnownErrorCode(error)
      ? persianMessage(error)
      : success === undefined
        ? null
        : (successMessages[success] ?? null);

  return (
    <>
      <AppHeader />
      {user.role === 'MANAGER' ? (
        <div className="mx-auto max-w-6xl px-4 pt-4">
          <Link
            className="text-sm font-semibold text-teal-800 underline"
            href={`/content/preview/therapists/${copyResult.data.copy.therapistId}`}
          >
            پیش‌نمایش خصوصی نسخهٔ آماده
          </Link>
        </div>
      ) : null}
      <TherapistProfileEditor
        copy={copyResult.data.copy}
        profile={profileResult?.data.profile ?? null}
        media={mediaResult.ok ? mediaResult.data.media : []}
        therapistStatus={therapistResult.data.therapist.status}
        csrfToken={(await readCsrfCookie()) ?? ''}
        canPublishMedia={user.permissions.includes('media.publish')}
        message={message}
      />
    </>
  );
}
