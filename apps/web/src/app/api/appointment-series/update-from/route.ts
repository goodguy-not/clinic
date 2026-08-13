import { NextResponse, type NextRequest } from 'next/server';
import { updateAppointmentSeriesFromRequestSchema } from '@clinic/contracts';
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
import { toWesternDigits } from '@/server/numerals-fa';

export const runtime = 'nodejs';
const nullable = (value: string | undefined) => (value ?? '').trim() || null;

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
  const parsed = updateAppointmentSeriesFromRequestSchema.safeParse({
    fromAppointmentId: body['fromAppointmentId'],
    durationMinutes: Number(toWesternDigits(body['durationMinutes'] ?? '')),
    therapistId: body['therapistId'],
    roomId: body['roomId'],
    startTime: toWesternDigits(body['startTime'] ?? ''),
    note: nullable(body['note']),
    availabilityOverrideReason: nullable(body['availabilityOverrideReason']),
  });
  if (!parsed.success) return failureRedirect(request, path, 'VALIDATION_FAILED');
  const result = await api.updateAppointmentSeriesFrom(id.data, parsed.data, { sessionToken });
  if (!result.ok) return failureRedirect(request, path, result.code);
  return secureRedirect(
    request,
    `${path}?success=updated&changed=${result.data.changedAppointmentIds.length}`,
  );
}
