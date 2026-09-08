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
import { MediaWorkspace } from './media-workspace';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function MediaPage() {
  await requireSession({ requirePermission: ['media.read', 'media.upload', 'media.attach'] });
  const token = await readSessionToken();
  const result = await api.listMedia(await callerContext(token ?? undefined));

  return (
    <>
      <AppHeader />
      <MediaWorkspace
        media={result.ok ? result.data.media : []}
        csrfToken={(await readCsrfCookie()) ?? ''}
        loadError={result.ok ? null : persianMessage(result.code)}
      />
    </>
  );
}
