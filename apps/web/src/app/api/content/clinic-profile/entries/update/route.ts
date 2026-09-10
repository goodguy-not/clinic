import { type NextRequest, type NextResponse } from 'next/server';
import { updateClinicContentEntryRequestSchema } from '@clinic/contracts';
import { z } from 'zod';
import { api } from '@/server/api-client';
import { clinicContentEntryForm } from '@/server/editorial-forms';
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
  const parsed = updateClinicContentEntryRequestSchema.safeParse(clinicContentEntryForm(body));
  if (!id.success || !parsed.success) {
    return failureRedirect(request, '/content/clinic-profile', 'VALIDATION_FAILED');
  }

  const result = await api.updateClinicContentEntry(id.data, parsed.data, { sessionToken });
  if (!result.ok) return failureRedirect(request, '/content/clinic-profile', result.code);

  return secureRedirect(request, '/content/clinic-profile?success=entry-saved');
}
