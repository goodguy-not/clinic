import { NextResponse, type NextRequest } from 'next/server';
import { userRoleSchema } from '@clinic/contracts';
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

/**
 * Change a staff role.
 *
 * NestJS refuses a self-change and refuses to demote the last active manager,
 * holding an advisory lock so two concurrent demotions cannot both succeed. The
 * change takes effect on the target's next request with no session revocation,
 * because role is resolved from the database per request.
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

  const role = userRoleSchema.safeParse(body['role']);
  if (!role.success) return failureRedirect(request, '/staff', 'VALIDATION_FAILED');

  const result = await api.changeRole(body['id'] ?? '', role.data, { sessionToken });

  if (!result.ok) return failureRedirect(request, '/staff', result.code);

  return secureRedirect(request, '/staff');
}
