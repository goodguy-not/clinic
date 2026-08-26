import { api } from '@/server/api-client';
import {
  callerContext,
  readCsrfCookie,
  readSessionToken,
  requireSession,
} from '@/server/auth-session';
import { persianMessage } from '@/server/errors-fa';
import { isKnownErrorCode } from '@/server/handler-support';
import { StaffAdmin } from './staff-admin';
import { AppHeader } from '@/components/app-header';

export const dynamic = 'force-dynamic';

/**
 * Manager-only. `requireSession` sends a receptionist away before anything is
 * fetched, and NestJS refuses every underlying call for them regardless — the
 * permission check here decides what to render, never what is allowed.
 */
export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession({ requirePermission: 'user.read' });

  const token = await readSessionToken();
  const result = await api.listUsers(await callerContext(token ?? undefined));

  const params = await searchParams;
  const rawError = params['error'];
  const code = typeof rawError === 'string' ? rawError : null;

  const errorMessage = isKnownErrorCode(code)
    ? persianMessage(code)
    : result.ok
      ? null
      : persianMessage(result.code);

  return (
    <>
      <AppHeader />
      <StaffAdmin
        users={result.ok ? result.data.users : []}
        csrfToken={(await readCsrfCookie()) ?? ''}
        errorMessage={errorMessage}
        currentUserId={user.id}
      />
    </>
  );
}
