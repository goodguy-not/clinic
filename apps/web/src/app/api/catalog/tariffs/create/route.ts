import { NextResponse, type NextRequest } from 'next/server';
import { createTariffRequestSchema } from '@clinic/contracts';
import { api } from '@/server/api-client';
import { tariffFormToRequest } from '@/server/catalog-forms';
import {
  failureRedirect,
  guardFailureResponse,
  guardStateChanging,
  readBody,
  sessionTokenFrom,
} from '@/server/handler-support';
import { jalaliToIsoDate } from '@/server/jalali';
import { secureRedirect } from '@/server/security-headers';

export const runtime = 'nodejs';

/**
 * Create a tariff, optionally superseding one.
 *
 * The form carries no client JavaScript, so both the paid and the free fields
 * arrive on every submission. `tariffFormToRequest` builds a payload for the
 * chosen branch only — and refuses one whose branches contradict each other,
 * rather than silently dropping the field that does not fit.
 *
 * Jalali components become a Gregorian ISO date here, before the shared
 * contract sees them. Nothing below this line knows what a Jalali date is.
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

  const supersedes = body['supersedesTariffId'];
  const formPath: `/${string}` =
    supersedes === undefined || supersedes === ''
      ? '/tariffs/new'
      : `/tariffs/new?supersedes=${encodeURIComponent(supersedes)}`;

  const built = tariffFormToRequest(body, jalaliToIsoDate);

  if (!built.ok) {
    return failureRedirect(
      request,
      formPath,
      built.reason === 'INVALID_DATE' ? 'TARIFF_DATE_INVALID' : 'TARIFF_BRANCH_CONTRADICTORY',
    );
  }

  const parsed = createTariffRequestSchema.safeParse(built.payload);

  if (!parsed.success) return failureRedirect(request, formPath, 'VALIDATION_FAILED');

  const result = await api.createTariff(parsed.data, { sessionToken });

  if (!result.ok) return failureRedirect(request, formPath, result.code);

  return secureRedirect(request, '/tariffs');
}
