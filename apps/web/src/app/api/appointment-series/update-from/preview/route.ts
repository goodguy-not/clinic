import { NextResponse, type NextRequest } from 'next/server';
import { updateAppointmentSeriesFromRequestSchema } from '@clinic/contracts';
import { z } from 'zod';
import { api } from '@/server/api-client';
import {
  guardFailureResponse,
  guardStateChanging,
  readBody,
  sessionTokenFrom,
} from '@/server/handler-support';
import { toWesternDigits } from '@/server/numerals-fa';
import { persianMessage } from '@/server/errors-fa';
import { applySecurityHeaders } from '@/server/security-headers';

export const runtime = 'nodejs';
const nullable = (value: string | undefined) => (value ?? '').trim() || null;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await readBody(request);
  const sessionToken = sessionTokenFrom(request);
  if (sessionToken === null)
    return applySecurityHeaders(
      NextResponse.json({ error: 'نشست شما پایان یافته است.' }, { status: 401 }),
    );
  try {
    guardStateChanging(request, body, { sessionToken });
  } catch (error) {
    const refusal = guardFailureResponse(error);
    if (refusal !== null) return refusal;
    throw error;
  }
  const id = z.uuid().safeParse(body['seriesId']);
  const parsed = updateAppointmentSeriesFromRequestSchema.safeParse({
    fromAppointmentId: body['fromAppointmentId'],
    durationMinutes: Number(toWesternDigits(body['durationMinutes'] ?? '')),
    therapistId: body['therapistId'],
    roomId: body['roomId'],
    weekday: body['weekday'] ? Number(toWesternDigits(body['weekday'])) : null,
    startTime: toWesternDigits(body['startTime'] ?? ''),
    note: nullable(body['note']),
    availabilityOverrideReason: nullable(body['availabilityOverrideReason']),
  });
  if (!id.success || !parsed.success)
    return applySecurityHeaders(
      NextResponse.json({ error: persianMessage('VALIDATION_FAILED') }, { status: 400 }),
    );
  const result = await api.previewAppointmentSeriesUpdateFrom(id.data, parsed.data, {
    sessionToken,
  });
  return applySecurityHeaders(
    result.ok
      ? NextResponse.json(result.data)
      : NextResponse.json({ error: persianMessage(result.code) }, { status: result.status }),
  );
}
