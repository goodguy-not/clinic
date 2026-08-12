import { NextResponse, type NextRequest } from 'next/server';
import { moveAppointmentRequestSchema } from '@clinic/contracts';
import { z } from 'zod';
import { api } from '@/server/api-client';
import { appointmentMoveFormToRequest } from '@/server/appointment-forms';
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

  const id = z.uuid().safeParse(body['id']);
  if (!id.success) return failureRedirect(request, '/appointments', 'VALIDATION_FAILED');
  const editPath = `/appointments/${id.data}/edit` as const;
  const payload = appointmentMoveFormToRequest(body);
  if (payload['startsAt'] === null) {
    return failureRedirect(request, editPath, 'APPOINTMENT_TIME_INVALID');
  }
  const parsed = moveAppointmentRequestSchema.safeParse(payload);
  if (!parsed.success) return failureRedirect(request, editPath, 'VALIDATION_FAILED');

  const result = await api.moveAppointment(id.data, parsed.data, { sessionToken });
  if (!result.ok) return failureRedirect(request, editPath, result.code);

  return secureRedirect(request, `/appointments/${id.data}?success=moved`);
}
