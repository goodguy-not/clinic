import type { Metadata } from 'next';
import { api } from '@/server/api-client';
import {
  callerContext,
  readCsrfCookie,
  readSessionToken,
  requireSession,
} from '@/server/auth-session';
import { persianMessage } from '@/server/errors-fa';
import { isKnownErrorCode } from '@/server/handler-support';
import { ServiceList } from './service-list';
import { AppHeader } from '@/components/app-header';

export const dynamic = 'force-dynamic';

/** Internal administration is never indexed. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Manager-only. The permission check here decides what to render; NestJS
 * refuses every underlying call for a receptionist regardless, so this is a
 * courtesy rather than the enforcement.
 */
export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession({ requirePermission: 'service.read' });

  const token = await readSessionToken();
  const result = await api.listServices(await callerContext(token ?? undefined));

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
      <ServiceList
        services={result.ok ? result.data.services : []}
        csrfToken={(await readCsrfCookie()) ?? ''}
        errorMessage={errorMessage}
        canCreate={user.permissions.includes('service.create')}
        canUpdate={user.permissions.includes('service.update')}
        canUpdateStatus={user.permissions.includes('service.update_status')}
      />
    </>
  );
}
