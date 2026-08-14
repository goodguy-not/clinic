import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cookieConfigFor } from '@/server/cookie-config';
import { issueCsrfToken } from '@/server/csrf';
import { signSessionCookie } from '@/server/session-cookie';

const { voidChargeAdjustment } = vi.hoisted(() => ({
  voidChargeAdjustment: vi.fn(),
}));

vi.mock('@/server/api-client', () => ({
  api: { voidChargeAdjustment },
}));

import { POST } from './route';

const ORIGIN = 'http://localhost:3000';
const SECRET = process.env['SESSION_COOKIE_SECRET'] as string;
const SESSION_TOKEN = 'synthetic-ledger-session-token';
const FAMILY_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b01';
const CHARGE_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b05';
const ADJUSTMENT_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b06';
const COOKIES = cookieConfigFor('non-production');

function adjustmentVoidRequest(): NextRequest {
  const csrfToken = issueCsrfToken(SECRET, { sessionToken: SESSION_TOKEN }, 1800);
  const cookie = [
    `${COOKIES.session.name}=${signSessionCookie(SECRET, SESSION_TOKEN)}`,
    `${COOKIES.csrf.name}=${csrfToken}`,
  ].join('; ');

  return new NextRequest(`${ORIGIN}/api/ledger/adjustments/void`, {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      cookie,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      familyId: FAMILY_ID,
      chargeId: CHARGE_ID,
      adjustmentId: ADJUSTMENT_ID,
      reason: 'waiver entered in error',
      csrfToken,
    }).toString(),
  });
}

describe('POST /api/ledger/adjustments/void', () => {
  beforeEach(() => {
    voidChargeAdjustment.mockReset();
    voidChargeAdjustment.mockResolvedValue({ ok: true, data: {} });
  });

  it('keeps the browser route stable and passes both parent and adjustment ids server-side', async () => {
    const response = await POST(adjustmentVoidRequest());

    expect(voidChargeAdjustment).toHaveBeenCalledWith(
      CHARGE_ID,
      ADJUSTMENT_ID,
      { reason: 'waiver entered in error' },
      { sessionToken: SESSION_TOKEN },
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `${ORIGIN}/families/${FAMILY_ID}/account?success=adjustment-voided`,
    );
  });
});
