import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cookieConfigFor } from '@/server/cookie-config';
import { issueCsrfToken } from '@/server/csrf';
import { signSessionCookie } from '@/server/session-cookie';

const mocks = vi.hoisted(() => ({
  createSpace: vi.fn(),
  updateSpace: vi.fn(),
  updateSpacePublication: vi.fn(),
}));
const invalidateSpacesPublication = vi.hoisted(() => vi.fn());
vi.mock('@/server/api-client', () => ({ api: mocks }));
vi.mock('@/server/public-cache-invalidation', () => ({ invalidateSpacesPublication }));

import { POST as createSpace } from './create/route';
import { POST as publishSpace } from './publication/route';
import { POST as updateSpace } from './update/route';

const ORIGIN = 'http://localhost:3000';
const SECRET = process.env['SESSION_COOKIE_SECRET'] as string;
const SESSION_TOKEN = 'synthetic-space-session-token';
const SPACE_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d91';
const COOKIES = cookieConfigFor('non-production');
const SPACE = {
  id: SPACE_ID,
  name: 'فضای ساختگی',
  description: null,
  displayOrder: 0,
  isPublic: false,
  hasUnpublishedChanges: false,
  firstPublishedAt: null,
  publicRevisedAt: null,
  createdAt: '2026-09-01T08:00:00.000Z',
};

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

beforeEach(() => {
  invalidateSpacesPublication.mockReset();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.createSpace.mockResolvedValue({ ok: true, data: { space: SPACE } });
  mocks.updateSpace.mockResolvedValue({ ok: true, data: { space: SPACE } });
  mocks.updateSpacePublication.mockResolvedValue({
    ok: true,
    data: { space: { ...SPACE, isPublic: true } },
  });
});

describe('public-space draft handlers', () => {
  it('creates a draft without forwarding publication or room fields', async () => {
    const response = await createSpace(
      request('/api/content/spaces/create', {
        name: ' فضای ساختگی ',
        description: ' ',
        displayOrder: '3',
        isPublic: 'true',
        roomId: '00000000-0000-4000-8000-000000000000',
      }),
    );

    expect(mocks.createSpace).toHaveBeenCalledWith(
      { name: 'فضای ساختگی', description: null, displayOrder: 3 },
      { sessionToken: SESSION_TOKEN },
    );
    expect(response.headers.get('location')).toBe(
      `${ORIGIN}/content/spaces/${SPACE_ID}/edit?success=space-created`,
    );
  });

  it('updates only draft copy and ordering', async () => {
    await updateSpace(
      request('/api/content/spaces/update', {
        id: SPACE_ID,
        name: 'فضای ویرایش‌شده',
        description: 'توضیح ساختگی',
        displayOrder: '4',
        isPublic: 'true',
      }),
    );

    expect(mocks.updateSpace).toHaveBeenCalledWith(
      SPACE_ID,
      { name: 'فضای ویرایش‌شده', description: 'توضیح ساختگی', displayOrder: 4 },
      { sessionToken: SESSION_TOKEN },
    );
  });
});

describe('public-space manager authority handler', () => {
  it('passes an explicit publication decision through the named API call', async () => {
    await publishSpace(
      request('/api/content/spaces/publication', { id: SPACE_ID, isPublic: 'true' }),
    );

    expect(mocks.updateSpacePublication).toHaveBeenCalledWith(
      SPACE_ID,
      { isPublic: true },
      { sessionToken: SESSION_TOKEN },
    );
  });

  it('preserves a server-side receptionist refusal', async () => {
    mocks.updateSpacePublication.mockResolvedValueOnce({
      ok: false,
      code: 'AUTH_FORBIDDEN',
      status: 403,
    });

    const response = await publishSpace(
      request('/api/content/spaces/publication', { id: SPACE_ID, isPublic: 'true' }),
    );

    expect(response.headers.get('location')).toBe(`${ORIGIN}/content/spaces?error=AUTH_FORBIDDEN`);
  });

  it('rejects malformed authority values before calling the API', async () => {
    const response = await publishSpace(
      request('/api/content/spaces/publication', { id: SPACE_ID, isPublic: 'yes' }),
    );

    expect(response.headers.get('location')).toContain('error=VALIDATION_FAILED');
    expect(mocks.updateSpacePublication).not.toHaveBeenCalled();
  });
});
