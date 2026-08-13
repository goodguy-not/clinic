import { NextResponse, type NextRequest } from 'next/server';
import { cancelAppointmentSeriesFromRequestSchema } from '@clinic/contracts';
import { z } from 'zod';
import { api } from '@/server/api-client';
import {
  failureRedirect,
  guardFailureResponse,
  guardStateChanging,
  readBody,
  sessionTokenFrom,
} from '@/server/handler-support';
import { secureRedirect } from '@/server/security-headers';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await readBody(request);
  const sessionToken = sessionTokenFrom(request);
  if (sessionToken === null) return secureRedirect(request, '/session-expired');
  try {
    guardStateChanging(request, body, { sessionToken });
  } catch (error) {
    const refusal = guardFailureResponse(error);
    if (refusal !== null) return refusal;
    throw error;
  }
  const id = z.uuid().safeParse(body['seriesId']);
  if (!id.success) return failureRedirect(request, '/appointments', 'VALIDATION_FAILED');
  const path = `/appointment-series/${id.data}` as const;
  const parsed = cancelAppointmentSeriesFromRequestSchema.safeParse({
    fromAppointmentId: body['fromAppointmentId'],
    cancelledBy: body['cancelledBy'],
    reason: body['reason'],
  });
  if (!parsed.success) return failureRedirect(request, path, 'VALIDATION_FAILED');
  const result = await api.cancelAppointmentSeriesFrom(id.data, parsed.data, { sessionToken });
  if (!result.ok) return failureRedirect(request, path, result.code);
  return secureRedirect(
    request,
    `${path}?success=cancelled&changed=${result.data.changedAppointmentIds.length}`,
  );
}
