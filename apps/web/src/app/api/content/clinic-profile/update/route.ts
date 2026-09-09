import { type NextRequest, type NextResponse } from 'next/server';
import { updateClinicProfileRequestSchema } from '@clinic/contracts';
import { api } from '@/server/api-client';
import { clinicProfileForm } from '@/server/editorial-forms';
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
  const token = sessionTokenFrom(request);
  if (token === null) return secureRedirect(request, '/session-expired');
  try {
    guardStateChanging(request, body, { sessionToken: token });
  } catch (error) {
    const refusal = guardFailureResponse(error);
    if (refusal !== null) return refusal;
    throw error;
  }
  const parsed = updateClinicProfileRequestSchema.safeParse(clinicProfileForm(body));
  if (!parsed.success)
    return failureRedirect(request, '/content/clinic-profile', 'VALIDATION_FAILED');
  const result = await api.updateClinicProfile(parsed.data, { sessionToken: token });
  if (!result.ok) return failureRedirect(request, '/content/clinic-profile', result.code);
  return secureRedirect(request, '/content/clinic-profile?success=saved');
}
