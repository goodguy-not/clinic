import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cookieConfigFor } from '@/server/cookie-config';
import { issueCsrfToken } from '@/server/csrf';
import { signSessionCookie } from '@/server/session-cookie';

const mocks = vi.hoisted(() => ({ createPayment: vi.fn(), voidPayment: vi.fn() }));
vi.mock('@/server/api-client', () => ({ api: mocks }));

import { POST as createPayment } from './create/route';
import { POST as voidPayment } from './void/route';

const ORIGIN = 'http://localhost:3000';
const SECRET = process.env['SESSION_COOKIE_SECRET'] as string;
const SESSION_TOKEN = 'synthetic-payment-session-token';
const FAMILY_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c01';
const PAYMENT_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c02';
const COOKIES = cookieConfigFor('non-production');

function request(path: string, body: Record<string, string>, origin = ORIGIN): NextRequest {
  const csrfToken = issueCsrfToken(SECRET, { sessionToken: SESSION_TOKEN }, 1800);
  const cookie = [
    `${COOKIES.session.name}=${signSessionCookie(SECRET, SESSION_TOKEN)}`,
    `${COOKIES.csrf.name}=${csrfToken}`,
  ].join('; ');
  return new NextRequest(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { origin, cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...body, csrfToken }).toString(),
  });
}

describe('payment BFF handlers', () => {
  beforeEach(() => {
    mocks.createPayment.mockReset().mockResolvedValue({ ok: true, data: {} });
    mocks.voidPayment.mockReset().mockResolvedValue({ ok: true, data: {} });
  });

  it('folds Persian amount/date digits, accepts optionals and redirects create with 303', async () => {
    const response = await createPayment(
      request('/api/payments/create', {
        familyId: FAMILY_ID,
        amountToman: '۱٬۲۵۰٬۰۰۰',
        method: 'TRANSFER',
        'receivedOn-year': '۱۴۰۵',
        'receivedOn-month': '۵',
        'receivedOn-day': '۲۵',
        reference: ' پیگیری-۱ ',
        note: ' دریافت حضوری ',
      }),
    );
    expect(mocks.createPayment).toHaveBeenCalledWith(
      FAMILY_ID,
      {
        amountToman: '1250000',
        method: 'TRANSFER',
        receivedOn: '2026-08-16',
        reference: 'پیگیری-۱',
        note: 'دریافت حضوری',
      },
      { sessionToken: SESSION_TOKEN },
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `${ORIGIN}/families/${FAMILY_ID}/account?success=payment-created`,
    );
  });

  it.each(['CASH', 'CARD', 'TRANSFER'])('passes the allowed %s method', async (method) => {
    await createPayment(
      request('/api/payments/create', {
        familyId: FAMILY_ID,
        amountToman: '1000',
        method,
        'receivedOn-year': '1405',
        'receivedOn-month': '5',
        'receivedOn-day': '25',
      }),
    );
    expect(mocks.createPayment.mock.calls.at(-1)?.[1].method).toBe(method);
  });

  it('omits blank optional values and refuses invalid Jalali input before the API', async () => {
    const blank = await createPayment(
      request('/api/payments/create', {
        familyId: FAMILY_ID,
        amountToman: '1000',
        method: 'CASH',
        'receivedOn-year': '1405',
        'receivedOn-month': '5',
        'receivedOn-day': '25',
        reference: ' ',
        note: '',
      }),
    );
    expect(mocks.createPayment.mock.calls.at(-1)?.[1]).toEqual({
      amountToman: '1000',
      method: 'CASH',
      receivedOn: '2026-08-16',
    });
    expect(blank.status).toBe(303);

    const invalid = await createPayment(
      request('/api/payments/create', {
        familyId: FAMILY_ID,
        amountToman: '1000',
        method: 'CASH',
        'receivedOn-year': '1404',
        'receivedOn-month': '12',
        'receivedOn-day': '30',
      }),
    );
    expect(invalid.headers.get('location')).toContain('error=VALIDATION_FAILED');
    expect(mocks.createPayment).toHaveBeenCalledTimes(1);
  });

  it('requires void reason, passes the payment id, and preserves frozen API errors', async () => {
    const invalid = await voidPayment(
      request('/api/payments/void', { familyId: FAMILY_ID, paymentId: PAYMENT_ID, reason: '' }),
    );
    expect(invalid.headers.get('location')).toContain('error=VALIDATION_FAILED');
    expect(mocks.voidPayment).not.toHaveBeenCalled();

    mocks.voidPayment.mockResolvedValueOnce({ ok: false, code: 'PAYMENT_ALREADY_VOIDED' });
    const failed = await voidPayment(
      request('/api/payments/void', {
        familyId: FAMILY_ID,
        paymentId: PAYMENT_ID,
        reason: 'ثبت اشتباه',
      }),
    );
    expect(mocks.voidPayment).toHaveBeenCalledWith(
      PAYMENT_ID,
      { reason: 'ثبت اشتباه' },
      { sessionToken: SESSION_TOKEN },
    );
    expect(failed.status).toBe(303);
    expect(failed.headers.get('location')).toContain('error=PAYMENT_ALREADY_VOIDED');
  });

  it('redirects successful void to history and rejects bad Origin/CSRF without mutation', async () => {
    const success = await voidPayment(
      request('/api/payments/void', {
        familyId: FAMILY_ID,
        paymentId: PAYMENT_ID,
        reason: 'اصلاح مالی',
      }),
    );
    expect(success.status).toBe(303);
    expect(success.headers.get('location')).toBe(
      `${ORIGIN}/families/${FAMILY_ID}/payments?success=payment-voided`,
    );

    const badOrigin = await createPayment(
      request(
        '/api/payments/create',
        {
          familyId: FAMILY_ID,
          amountToman: '1000',
          method: 'CASH',
          'receivedOn-year': '1405',
          'receivedOn-month': '5',
          'receivedOn-day': '25',
        },
        'https://evil.example',
      ),
    );
    expect(badOrigin.status).toBe(403);

    const noCsrf = request('/api/payments/void', {
      familyId: FAMILY_ID,
      paymentId: PAYMENT_ID,
      reason: 'اصلاح',
    });
    const body = await noCsrf.text();
    const badCsrf = new NextRequest(`${ORIGIN}/api/payments/void`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        cookie: noCsrf.headers.get('cookie') ?? '',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: body.replace(/csrfToken=[^&]+/, 'csrfToken=bad'),
    });
    expect((await voidPayment(badCsrf)).status).toBe(403);
  });
});
