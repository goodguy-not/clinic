import { NextResponse, type NextRequest } from 'next/server';
import { createRoomRequestSchema } from '@clinic/contracts';
import { api } from '@/server/api-client';
import { roomFormToRequest } from '@/server/catalog-forms';
import {
  failureRedirect,
  guardFailureResponse,
  guardStateChanging,
  readBodyWithLists,
  sessionTokenFrom,
} from '@/server/handler-support';
import { secureRedirect } from '@/server/security-headers';

export const runtime = 'nodejs';

/**
 * Create a treatment room.
 *
 * `readBodyWithLists` because the service allow-list is a `<select multiple>`:
 * the flat reader keeps only the last selection, which would quietly restrict a
 * room to one service when three were chosen.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const { body, lists } = await readBodyWithLists(request);
  const sessionToken = sessionTokenFrom(request);

  if (sessionToken === null) return secureRedirect(request, '/session-expired');

  try {
    guardStateChanging(request, body, { sessionToken });
  } catch (error) {
    const refusal = guardFailureResponse(error);
    if (refusal !== null) return refusal;
    throw error;
  }

  const candidate = roomFormToRequest(body, lists['serviceIds'] ?? []);
  const parsed = createRoomRequestSchema.safeParse(candidate);

  if (!parsed.success) return failureRedirect(request, '/rooms/new', 'VALIDATION_FAILED');

  const result = await api.createRoom(parsed.data, { sessionToken });

  if (!result.ok) return failureRedirect(request, '/rooms/new', result.code);

  return secureRedirect(request, '/rooms');
}
