import { NextResponse, type NextRequest } from 'next/server';
import { updateRoomRequestSchema } from '@clinic/contracts';
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
 * Edit a room, replacing its service restrictions in the same request.
 *
 * NestJS applies the name change and the restriction set in one transaction, so
 * a rejected service id leaves the previous restrictions exactly as they were
 * rather than half-applied.
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

  const id = body['id'] ?? '';
  const editPath: `/${string}` = `/rooms/${encodeURIComponent(id)}/edit`;

  const parsed = updateRoomRequestSchema.safeParse(
    roomFormToRequest(body, lists['serviceIds'] ?? []),
  );

  if (!parsed.success) return failureRedirect(request, editPath, 'VALIDATION_FAILED');

  const result = await api.updateRoom(id, parsed.data, { sessionToken });

  if (!result.ok) return failureRedirect(request, editPath, result.code);

  return secureRedirect(request, '/rooms');
}
