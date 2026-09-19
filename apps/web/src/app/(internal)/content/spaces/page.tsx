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
import { firstQueryValue, SPACE_SUCCESS_MESSAGES } from './presentation';
import { SpaceWorkspace } from './space-workspace';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function SpacesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession({ requirePermission: 'public_space.read' });
  const token = await readSessionToken();
  const [result, query] = await Promise.all([
    api.listSpaces(await callerContext(token ?? undefined)),
    searchParams,
  ]);
  const errorCode = firstQueryValue(query['error']);
  const success = firstQueryValue(query['success']);

  return (
    <>
      <AppHeader />
      <SpaceWorkspace
        spaces={result.ok ? result.data.spaces : []}
        csrfToken={(await readCsrfCookie()) ?? ''}
        errorMessage={
          errorCode && isKnownErrorCode(errorCode)
            ? persianMessage(errorCode)
            : result.ok
              ? null
              : persianMessage(result.code)
        }
        successMessage={success ? (SPACE_SUCCESS_MESSAGES[success] ?? null) : null}
        canDraft={user.permissions.includes('public_space.draft')}
        canPublish={user.permissions.includes('public_space.publish')}
      />
    </>
  );
}
