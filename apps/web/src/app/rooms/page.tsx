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
import { RoomList } from './room-list';
import { AppHeader } from '@/components/app-header';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function RoomsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession({ requirePermission: 'room.read' });

  const token = await readSessionToken();
  const context = await callerContext(token ?? undefined);

  // Services are fetched so the list can show restriction names rather than
  // ids. Page-specific aggregation is exactly what the selective BFF is for.
  const [rooms, services] = await Promise.all([api.listRooms(context), api.listServices(context)]);

  const params = await searchParams;
  const rawError = params['error'];
  const code = typeof rawError === 'string' ? rawError : null;

  const errorMessage = isKnownErrorCode(code)
    ? persianMessage(code)
    : rooms.ok
      ? null
      : persianMessage(rooms.code);

  return (
    <>
      <AppHeader />
      <RoomList
        rooms={rooms.ok ? rooms.data.rooms : []}
        services={services.ok ? services.data.services : []}
        csrfToken={(await readCsrfCookie()) ?? ''}
        errorMessage={errorMessage}
        canCreate={user.permissions.includes('room.create')}
        canUpdate={user.permissions.includes('room.update')}
        canUpdateStatus={user.permissions.includes('room.update_status')}
      />
    </>
  );
}
