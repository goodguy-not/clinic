import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cookieConfigFor } from '@/server/cookie-config';
import { issueCsrfToken } from '@/server/csrf';
import { signSessionCookie } from '@/server/session-cookie';

const mocks = vi.hoisted(() => ({
  updateClinicContentEntry: vi.fn(),
  updateMediaPublication: vi.fn(),
}));
const invalidations = vi.hoisted(() => ({ clinic: vi.fn(), media: vi.fn() }));

vi.mock('@/server/api-client', () => ({ api: mocks }));
vi.mock('@/server/public-cache-invalidation', () => ({
  invalidateClinicPublication: invalidations.clinic,
  invalidateMediaPublication: invalidations.media,
}));

import { POST as updateEntry } from './entries/update/route';
import { POST as updateMediaPublication } from '../../media/publication/route';

const ORIGIN = 'http://localhost:3000';
const SECRET = process.env['SESSION_COOKIE_SECRET'] as string;
const SESSION_TOKEN = 'synthetic-clinic-content-session';
const ENTRY_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a90';
const ATTACHMENT_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a91';
const COOKIES = cookieConfigFor('non-production');

function request(path: string, body: Record<string, string>): NextRequest {
  const csrfToken = issueCsrfToken(SECRET, { sessionToken: SESSION_TOKEN }, 1800);
  const cookie = [
    `${COOKIES.session.name}=${signSessionCookie(SECRET, SESSION_TOKEN)}`,
    `${COOKIES.csrf.name}=${csrfToken}`,
  ].join('; ');
  return new NextRequest(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN, cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...body, csrfToken }).toString(),
  });
}

beforeEach(() => {
  invalidations.clinic.mockReset();
  invalidations.media.mockReset();
  mocks.updateClinicContentEntry.mockReset();
  mocks.updateMediaPublication.mockReset();
  mocks.updateClinicContentEntry.mockResolvedValue({ ok: true, data: { entry: {} } });
  mocks.updateMediaPublication.mockResolvedValue({
    ok: true,
    data: {
      media: {},
      publication: {
        attachmentId: ATTACHMENT_ID,
        ownerType: 'CLINIC_OPEN_GRAPH',
        ownerId: null,
        publicSlug: null,
        ownerIsPublic: true,
        renditionIds: [],
      },
    },
  });
});

describe('clinic content entry handler', () => {
  it('sends only the four editable text fields and cannot move a fixed entry', async () => {
    const response = await updateEntry(
      request('/api/content/clinic-profile/entries/update', {
        id: ENTRY_ID,
        label: ' برچسب ساختگی ',
        eyebrow: ' ',
        heading: ' عنوان ساختگی ',
        body: ' متن ساختگی ',
        slot: 'ABOUT_INTRO',
        position: '12',
      }),
    );

    expect(mocks.updateClinicContentEntry).toHaveBeenCalledWith(
      ENTRY_ID,
      {
        label: 'برچسب ساختگی',
        eyebrow: null,
        heading: 'عنوان ساختگی',
        body: 'متن ساختگی',
      },
      { sessionToken: SESSION_TOKEN },
    );
    expect(response.headers.get('location')).toBe(`/content/clinic-profile?success=entry-saved`);
  });

  it('preserves an authoritative backend refusal', async () => {
    mocks.updateClinicContentEntry.mockResolvedValueOnce({
      ok: false,
      code: 'AUTH_FORBIDDEN',
      status: 403,
    });

    const response = await updateEntry(
      request('/api/content/clinic-profile/entries/update', {
        id: ENTRY_ID,
        label: '',
        eyebrow: '',
        heading: 'عنوان ساختگی',
        body: '',
      }),
    );

    expect(response.headers.get('location')).toBe(`/content/clinic-profile?error=AUTH_FORBIDDEN`);
  });
});

describe('clinic image publication handler', () => {
  it('publishes through A5 and returns only to the fixed clinic profile path', async () => {
    const response = await updateMediaPublication(
      request('/api/media/publication', {
        attachmentId: ATTACHMENT_ID,
        clinicProfile: 'true',
        isPublished: 'true',
      }),
    );

    expect(mocks.updateMediaPublication).toHaveBeenCalledWith(
      ATTACHMENT_ID,
      { isPublished: true },
      { sessionToken: SESSION_TOKEN },
    );
    expect(response.headers.get('location')).toBe(
      `/content/clinic-profile?success=image-published`,
    );
  });

  it('rejects a malformed publication value before calling the API', async () => {
    const response = await updateMediaPublication(
      request('/api/media/publication', {
        attachmentId: ATTACHMENT_ID,
        clinicProfile: 'true',
        isPublished: 'yes',
      }),
    );

    expect(response.headers.get('location')).toBe(
      `/content/clinic-profile?error=VALIDATION_FAILED`,
    );
    expect(mocks.updateMediaPublication).not.toHaveBeenCalled();
  });
});
