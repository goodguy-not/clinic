import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cookieConfigFor } from '@/server/cookie-config';
import { issueCsrfToken } from '@/server/csrf';
import { signSessionCookie } from '@/server/session-cookie';

const mocks = vi.hoisted(() => ({
  withdrawTestimonialConsent: vi.fn(),
  invalidateTestimonialsPublication: vi.fn(),
  invalidateMediaArchive: vi.fn(),
}));
vi.mock('@/server/api-client', () => ({
  api: { withdrawTestimonialConsent: mocks.withdrawTestimonialConsent },
}));
vi.mock('@/server/public-cache-invalidation', () => ({
  invalidateTestimonialsPublication: mocks.invalidateTestimonialsPublication,
  invalidateMediaArchive: mocks.invalidateMediaArchive,
}));
import { POST } from './route';

const ORIGIN = 'http://localhost:3000';
const TOKEN = 'synthetic-consent-session';
const SECRET = process.env['SESSION_COOKIE_SECRET'] as string;
const COOKIES = cookieConfigFor('non-production');
const ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d81';

function request(confirmed = 'yes'): NextRequest {
  const csrfToken = issueCsrfToken(SECRET, { sessionToken: TOKEN }, 1800);
  return new NextRequest(`${ORIGIN}/api/content/testimonials/consent-withdrawal`, {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      cookie: `${COOKIES.session.name}=${signSessionCookie(SECRET, TOKEN)}; ${COOKIES.csrf.name}=${csrfToken}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ id: ID, confirmed, csrfToken }).toString(),
  });
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.withdrawTestimonialConsent.mockResolvedValue({ ok: true });
});

describe('consent withdrawal write', () => {
  it('requires the explicit confirmation before calling the API', async () => {
    const response = await POST(request(''));
    expect(response.headers.get('location')).toContain('VALIDATION_FAILED');
    expect(mocks.withdrawTestimonialConsent).not.toHaveBeenCalled();
  });

  it('records withdrawal and invalidates public testimonial and photo projections', async () => {
    const response = await POST(request());
    expect(mocks.withdrawTestimonialConsent).toHaveBeenCalledWith(ID, { sessionToken: TOKEN });
    expect(response.headers.get('location')).toContain('testimonial-consent-withdrawn');
    expect(mocks.invalidateTestimonialsPublication).toHaveBeenCalledOnce();
    expect(mocks.invalidateMediaArchive).toHaveBeenCalledOnce();
  });

  it('refuses a direct receptionist request when the API denies approval authority', async () => {
    mocks.withdrawTestimonialConsent.mockResolvedValue({
      ok: false,
      status: 403,
      code: 'AUTH_FORBIDDEN',
    });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: 'AUTH_FORBIDDEN' } });
    expect(mocks.invalidateTestimonialsPublication).not.toHaveBeenCalled();
  });
});
