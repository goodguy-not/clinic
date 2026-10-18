import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { api } from '@/server/api-client';
import {
  callerContext,
  readCsrfCookie,
  readSessionToken,
  requireSession,
} from '@/server/auth-session';
import { persianMessage } from '@/server/errors-fa';
import { isKnownErrorCode } from '@/server/handler-support';
import { RoomForm } from '../../room-form';
import { AppHeader } from '@/components/app-header';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function EditRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession({ requirePermission: 'room.update' });

  const { id } = await params;
  const token = await readSessionToken();
  const context = await callerContext(token ?? undefined);

  const [room, services] = await Promise.all([api.getRoom(id, context), api.listServices(context)]);

  if (!room.ok) {
    if (room.code === 'ROOM_NOT_FOUND') notFound();
    throw new Error(`Failed to load room: ${room.code}`);
  }

  const query = await searchParams;
  const rawError = query['error'];
  const code = typeof rawError === 'string' ? rawError : null;

  return (
    <>
      <AppHeader />
      <RoomForm
        room={room.data.room}
        services={services.ok ? services.data.services : []}
        csrfToken={(await readCsrfCookie()) ?? ''}
        errorMessage={isKnownErrorCode(code) ? persianMessage(code) : null}
      />
    </>
  );
}
