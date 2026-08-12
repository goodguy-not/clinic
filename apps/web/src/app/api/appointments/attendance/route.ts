import { NextResponse, type NextRequest } from 'next/server';
import { recordAttendanceRequestSchema } from '@clinic/contracts';
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

  const ids = z
    .strictObject({ appointmentId: z.uuid(), participantId: z.uuid() })
    .safeParse({ appointmentId: body['id'], participantId: body['participantId'] });
  if (!ids.success) return failureRedirect(request, '/appointments', 'VALIDATION_FAILED');
  const detailPath = `/appointments/${ids.data.appointmentId}` as const;
  const parsed = recordAttendanceRequestSchema.safeParse({ attendance: body['attendance'] });
  if (!parsed.success) return failureRedirect(request, detailPath, 'VALIDATION_FAILED');

  const result = await api.recordAppointmentAttendance(
    ids.data.appointmentId,
    ids.data.participantId,
    parsed.data,
    { sessionToken },
  );
  if (!result.ok) return failureRedirect(request, detailPath, result.code);

  return secureRedirect(request, `${detailPath}?success=attendance`);
}
