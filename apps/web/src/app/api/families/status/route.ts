import { NextResponse, type NextRequest } from 'next/server';
import { familyBalanceSchema, updateFamilyStatusRequestSchema } from '@clinic/contracts';
import { api } from '@/server/api-client';
import {
  failureRedirect,
  guardFailureResponse,
  guardStateChanging,
  readBody,
  sessionTokenFrom,
} from '@/server/handler-support';
import { applySecurityHeaders, secureRedirect } from '@/server/security-headers';

export const runtime = 'nodejs';

/**
 * Activates or deactivates a family. Never a delete: a family holds the
 * balance and is named by every charge from Milestone 5 onward.
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

  const id = body['id'] ?? '';
  const acknowledgedBalance =
    body['amountDueToman'] !== undefined || body['creditToman'] !== undefined
      ? familyBalanceSchema.safeParse({
          amountDueToman: body['amountDueToman'],
          creditToman: body['creditToman'],
        })
      : null;
  if (acknowledgedBalance !== null && !acknowledgedBalance.success)
    return failureRedirect(request, `/families/${id}`, 'VALIDATION_FAILED');

  const payload = updateFamilyStatusRequestSchema.safeParse({
    status: body['status'],
    ...(acknowledgedBalance?.success ? { acknowledgedBalance: acknowledgedBalance.data } : {}),
  });
  if (!payload.success || id === '')
    return failureRedirect(request, '/families', 'VALIDATION_FAILED');

  const result = await api.changeFamilyStatus(id, payload.data, { sessionToken });

  if (!result.ok) {
    if (result.code === 'FAMILY_BALANCE_UNACKNOWLEDGED') {
      const balance = familyBalanceSchema.safeParse(result.details);
      if (balance.success) {
        const target = new URL(`/families/${encodeURIComponent(id)}`, request.url);
        target.searchParams.set('balanceDue', balance.data.amountDueToman);
        target.searchParams.set('balanceCredit', balance.data.creditToman);
        return applySecurityHeaders(NextResponse.redirect(target, 303));
      }
    }
    return failureRedirect(request, `/families/${id}`, result.code);
  }

  return secureRedirect(request, `/families/${id}`);
}
