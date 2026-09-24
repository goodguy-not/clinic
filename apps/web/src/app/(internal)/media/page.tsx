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
import { MediaWorkspace } from './media-workspace';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function MediaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession({
    requirePermission: ['media.read', 'media.upload', 'media.attach'],
  });
  const token = await readSessionToken();
  const [result, query] = await Promise.all([
    api.listMedia(await callerContext(token ?? undefined)),
    searchParams,
  ]);
  const rawError = Array.isArray(query['error']) ? query['error'][0] : query['error'];
  const loadError =
    rawError !== undefined && isKnownErrorCode(rawError)
      ? persianMessage(rawError)
      : result.ok
        ? null
        : persianMessage(result.code);

  return (
    <>
      <AppHeader />
      <MediaWorkspace
        media={result.ok ? result.data.media : []}
        csrfToken={(await readCsrfCookie()) ?? ''}
        canPublishMedia={user.permissions.includes('media.publish')}
        loadError={loadError}
      />
    </>
  );
}
