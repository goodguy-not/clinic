import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cookieConfigFor } from '@/server/cookie-config';
import { issueCsrfToken } from '@/server/csrf';
import { signSessionCookie } from '@/server/session-cookie';

const mocks = vi.hoisted(() => ({ changeFamilyStatus: vi.fn() }));
vi.mock('@/server/api-client', () => ({ api: mocks }));

import { POST } from './route';

const ORIGIN = 'http://localhost:3000';
const ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4e01';
const SECRET = process.env['SESSION_COOKIE_SECRET'] as string;
const SESSION_TOKEN = 'synthetic-family-status-session';
const COOKIES = cookieConfigFor('non-production');

function request(fields: Record<string, string>): NextRequest {
  const csrfToken = issueCsrfToken(SECRET, { sessionToken: SESSION_TOKEN }, 1800);
  const form = new FormData();
  Object.entries({ csrfToken, id: ID, status: 'INACTIVE', ...fields }).forEach(([key, value]) =>
    form.set(key, value),
  );
  return new NextRequest(`${ORIGIN}/api/families/status`, {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      cookie: [
        `${COOKIES.session.name}=${signSessionCookie(SECRET, SESSION_TOKEN)}`,
        `${COOKIES.csrf.name}=${csrfToken}`,
      ].join('; '),
    },
    body: form,
  });
}

describe('family status BFF', () => {
  beforeEach(() => mocks.changeFamilyStatus.mockReset());

  it.each([
    { amountDueToman: '1250000', creditToman: '0' },
    { amountDueToman: '0', creditToman: '300000' },
  ])('shows the API balance for acknowledgement', async (balance) => {
    mocks.changeFamilyStatus.mockResolvedValue({
      ok: false,
      code: 'FAMILY_BALANCE_UNACKNOWLEDGED',
      status: 409,
      details: balance,
    });
    const response = await POST(request({}));
    const target = new URL(response.headers.get('location') as string, ORIGIN);

    expect(mocks.changeFamilyStatus).toHaveBeenCalledWith(
      ID,
      { status: 'INACTIVE' },
      { sessionToken: SESSION_TOKEN },
    );
    expect(target.pathname).toBe(`/families/${ID}`);
    expect(target.searchParams.get('balanceDue')).toBe(balance.amountDueToman);
    expect(target.searchParams.get('balanceCredit')).toBe(balance.creditToman);
  });

  it('passes the shown figures verbatim and replaces them if the API reports a changed balance', async () => {
    const changed = { amountDueToman: '1100000', creditToman: '0' };
    mocks.changeFamilyStatus.mockResolvedValue({
      ok: false,
      code: 'FAMILY_BALANCE_UNACKNOWLEDGED',
      status: 409,
      details: changed,
    });
    const response = await POST(request({ amountDueToman: '1250000', creditToman: '0' }));
    expect(mocks.changeFamilyStatus).toHaveBeenCalledWith(
      ID,
      { status: 'INACTIVE', acknowledgedBalance: { amountDueToman: '1250000', creditToman: '0' } },
      { sessionToken: SESSION_TOKEN },
    );
    const target = new URL(response.headers.get('location') as string, ORIGIN);
    expect(target.searchParams.get('balanceDue')).toBe(changed.amountDueToman);
  });

  it('keeps zero-balance deactivation unchanged', async () => {
    mocks.changeFamilyStatus.mockResolvedValue({ ok: true, data: {} });
    const response = await POST(request({}));
    expect(mocks.changeFamilyStatus).toHaveBeenCalledWith(
      ID,
      { status: 'INACTIVE' },
      { sessionToken: SESSION_TOKEN },
    );
    expect(new URL(response.headers.get('location') as string, ORIGIN).pathname).toBe(
      `/families/${ID}`,
    );
  });
});
