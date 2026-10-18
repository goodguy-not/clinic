import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cookieConfigFor } from '@/server/cookie-config';
import { issueCsrfToken } from '@/server/csrf';
import { signSessionCookie } from '@/server/session-cookie';

const mocks = vi.hoisted(() => ({
  createPromise: vi.fn(),
  fulfillPromise: vi.fn(),
  reschedulePromise: vi.fn(),
  cancelPromise: vi.fn(),
}));
vi.mock('@/server/api-client', () => ({ api: mocks }));

import { POST as cancelPromise } from './cancel/route';
import { POST as createPromise } from './create/route';
import { POST as fulfillPromise } from './fulfill/route';
import { POST as reschedulePromise } from './reschedule/route';

const ORIGIN = 'http://localhost:3000';
const SECRET = process.env['SESSION_COOKIE_SECRET'] as string;
const SESSION_TOKEN = 'synthetic-promise-session-token';
const FAMILY_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c01';
const PROMISE_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c10';
const PAYMENT_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c20';
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

describe('promise BFF handlers', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks))
      mock.mockReset().mockResolvedValue({ ok: true, data: {} });
  });

  it.each([
    ['۱۴۰۵', '۵', '۲۵', '2026-08-16'],
    ['۱۴۰۵', '۵', '۲۴', '2026-08-15'],
  ])(
    'accepts today or past initial due date and normalizes Persian input',
    async (year, month, day, dueOn) => {
      const response = await createPromise(
        request('/api/promises/create', {
          familyId: FAMILY_ID,
          amountToman: '۱٬۲۵۰٬۰۰۰',
          'dueOn-year': year,
          'dueOn-month': month,
          'dueOn-day': day,
          note: ' پیگیری پذیرش ',
        }),
      );
      expect(mocks.createPromise).toHaveBeenCalledWith(
        FAMILY_ID,
        { amountToman: '1250000', dueOn, note: 'پیگیری پذیرش' },
        { sessionToken: SESSION_TOKEN },
      );
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toContain('success=promise-created');
    },
  );

  it('validates fulfilment and preserves the used-payment server refusal', async () => {
    const invalid = await fulfillPromise(
      request('/api/promises/fulfill', {
        familyId: FAMILY_ID,
        promiseId: PROMISE_ID,
        paymentId: 'bad',
      }),
    );
    expect(invalid.headers.get('location')).toContain('error=VALIDATION_FAILED');
    expect(mocks.fulfillPromise).not.toHaveBeenCalled();

    mocks.fulfillPromise.mockResolvedValueOnce({
      ok: false,
      code: 'PAYMENT_ALREADY_FULFILS_PROMISE',
    });
    const refused = await fulfillPromise(
      request('/api/promises/fulfill', {
        familyId: FAMILY_ID,
        promiseId: PROMISE_ID,
        paymentId: PAYMENT_ID,
      }),
    );
    expect(mocks.fulfillPromise).toHaveBeenCalledWith(
      PROMISE_ID,
      { paymentId: PAYMENT_ID },
      { sessionToken: SESSION_TOKEN },
    );
    expect(refused.headers.get('location')).toContain('error=PAYMENT_ALREADY_FULFILS_PROMISE');
  });

  it('requires reschedule reason and passes the frozen past-successor refusal', async () => {
    const invalid = await reschedulePromise(
      request('/api/promises/reschedule', {
        familyId: FAMILY_ID,
        promiseId: PROMISE_ID,
        'dueOn-year': '1405',
        'dueOn-month': '5',
        'dueOn-day': '25',
        reason: '',
      }),
    );
    expect(invalid.headers.get('location')).toContain('error=VALIDATION_FAILED');
    mocks.reschedulePromise.mockResolvedValueOnce({ ok: false, code: 'PROMISE_DUE_DATE_IN_PAST' });
    const refused = await reschedulePromise(
      request('/api/promises/reschedule', {
        familyId: FAMILY_ID,
        promiseId: PROMISE_ID,
        'dueOn-year': '1405',
        'dueOn-month': '5',
        'dueOn-day': '24',
        reason: 'هماهنگی خانواده',
      }),
    );
    expect(refused.headers.get('location')).toContain('error=PROMISE_DUE_DATE_IN_PAST');
  });

  it('requires cancellation reason and redirects successful cancellation with 303', async () => {
    const invalid = await cancelPromise(
      request('/api/promises/cancel', { familyId: FAMILY_ID, promiseId: PROMISE_ID, reason: ' ' }),
    );
    expect(invalid.headers.get('location')).toContain('error=VALIDATION_FAILED');
    const response = await cancelPromise(
      request('/api/promises/cancel', {
        familyId: FAMILY_ID,
        promiseId: PROMISE_ID,
        reason: 'پایان پیگیری',
      }),
    );
    expect(mocks.cancelPromise).toHaveBeenCalledWith(
      PROMISE_ID,
      { reason: 'پایان پیگیری' },
      { sessionToken: SESSION_TOKEN },
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `/families/${FAMILY_ID}/promises?success=promise-cancelled`,
    );
  });

  it('rejects bad Origin and CSRF before any promise mutation', async () => {
    const badOrigin = await createPromise(
      request(
        '/api/promises/create',
        {
          familyId: FAMILY_ID,
          amountToman: '1000',
          'dueOn-year': '1405',
          'dueOn-month': '5',
          'dueOn-day': '25',
        },
        'https://evil.example',
      ),
    );
    expect(badOrigin.status).toBe(403);

    const original = request('/api/promises/cancel', {
      familyId: FAMILY_ID,
      promiseId: PROMISE_ID,
      reason: 'اصلاح',
    });
    const body = await original.text();
    const badCsrf = new NextRequest(`${ORIGIN}/api/promises/cancel`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        cookie: original.headers.get('cookie') ?? '',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: body.replace(/csrfToken=[^&]+/, 'csrfToken=bad'),
    });
    expect((await cancelPromise(badCsrf)).status).toBe(403);
  });
});
