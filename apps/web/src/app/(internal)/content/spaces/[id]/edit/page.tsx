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
import { firstQueryValue, SPACE_SUCCESS_MESSAGES } from '../../presentation';
import { SpaceForm } from '../../space-form';
import { photosForSpace, SpacePhotoEditor } from '../../space-photo-editor';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function EditSpacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession({ requirePermission: 'public_space.draft' });
  const { id } = await params;
  const token = await readSessionToken();
  const context = await callerContext(token ?? undefined);
  const [spaceResult, mediaResult, query] = await Promise.all([
    api.getSpace(id, context),
    api.listMedia(context),
    searchParams,
  ]);
  if (!spaceResult.ok) {
    if (spaceResult.code === 'PUBLIC_SPACE_NOT_FOUND') notFound();
    throw new Error(`Failed to load public space: ${spaceResult.code}`);
  }

  const errorCode = firstQueryValue(query['error']);
  const success = firstQueryValue(query['success']);
  const csrfToken = (await readCsrfCookie()) ?? '';
  const space = spaceResult.data.space;

  return (
    <>
      <AppHeader />
      {user.role === 'MANAGER' ? (
        <div className="mx-auto max-w-6xl px-4 pt-4">
          <Link
            className="text-sm font-semibold text-teal-800 underline"
            href={`/content/preview/spaces/${space.id}`}
          >
            پیش‌نمایش خصوصی نسخهٔ آماده
          </Link>
        </div>
      ) : null}
      <SpaceForm
        space={space}
        csrfToken={csrfToken}
        errorMessage={
          errorCode && isKnownErrorCode(errorCode)
            ? persianMessage(errorCode)
            : mediaResult.ok
              ? null
              : persianMessage(mediaResult.code)
        }
        successMessage={success ? (SPACE_SUCCESS_MESSAGES[success] ?? null) : null}
      >
        <SpacePhotoEditor
          space={space}
          photos={photosForSpace(mediaResult.ok ? mediaResult.data.media : [], space.id)}
          csrfToken={csrfToken}
          canPublishMedia={user.permissions.includes('media.publish')}
          canPublishSpace={user.permissions.includes('public_space.publish')}
        />
      </SpaceForm>
    </>
  );
}
