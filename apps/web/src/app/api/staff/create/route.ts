import { NextResponse, type NextRequest } from 'next/server';
import { createUserRequestSchema } from '@clinic/contracts';
import { api } from '@/server/api-client';
import {
  failureRedirect,
  guardFailureResponse,
  guardStateChanging,
  readBody,
  sessionTokenFrom,
} from '@/server/handler-support';
import { secureRedirect } from '@/server/security-headers';
import { temporaryPasswordResponse } from '@/server/temporary-password-page';

export const runtime = 'nodejs';

/**
 * Create a staff account.
 *
 * NestJS generates the temporary password, hashes it and returns it exactly
 * once. It is rendered straight into this response body: never redirected with,
 * never stored, never logged.
 */
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

  const parsed = createUserRequestSchema.safeParse({
    username: body['username'] ?? '',
    displayName: body['displayName'] ?? '',
    role: body['role'] ?? '',
  });

  if (!parsed.success) return failureRedirect(request, '/staff', 'VALIDATION_FAILED');

  const result = await api.createUser(parsed.data, { sessionToken });

  if (!result.ok) return failureRedirect(request, '/staff', result.code);

  return temporaryPasswordResponse(result.data.user.username, result.data.temporaryPassword);
}
