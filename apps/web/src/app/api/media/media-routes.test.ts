import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cookieConfigFor } from '@/server/cookie-config';
import { issueCsrfToken } from '@/server/csrf';
import { signSessionCookie } from '@/server/session-cookie';

const mocks = vi.hoisted(() => ({
  uploadMedia: vi.fn(),
  createMediaAttachment: vi.fn(),
  getMedia: vi.fn(),
  updateMediaFraming: vi.fn(),
  updateMediaPublication: vi.fn(),
}));
vi.mock('@/server/api-client', () => ({ api: mocks }));

import { POST as attachDraft } from './draft-attachment/route';
import { POST as saveFraming } from './framing/route';
import { POST as setPublication } from './publication/route';
import { POST as uploadMedia } from './upload/route';

const ORIGIN = 'http://localhost:3000';
const SECRET = process.env['SESSION_COOKIE_SECRET'] as string;
const SESSION_TOKEN = 'synthetic-media-session';
const MEDIA_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d91';
const ATTACHMENT_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d92';
const COOKIES = cookieConfigFor('non-production');
const MEDIA = {
  id: MEDIA_ID,
  attachments: [
    {
      id: ATTACHMENT_ID,
      ownerType: 'CLINIC_SPACE',
      ownerId: null,
      position: 0,
      framing: { focalX: 0.5, focalY: 0.5, crop: null },
    },
  ],
};

function authentication() {
  const csrfToken = issueCsrfToken(SECRET, { sessionToken: SESSION_TOKEN }, 1800);
  return {
    csrfToken,
    cookie: [
      `${COOKIES.session.name}=${signSessionCookie(SECRET, SESSION_TOKEN)}`,
      `${COOKIES.csrf.name}=${csrfToken}`,
    ].join('; '),
  };
}

function jsonRequest(path: string, body: Record<string, unknown>): NextRequest {
  const auth = authentication();
  return new NextRequest(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN, cookie: auth.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, csrfToken: auth.csrfToken }),
  });
}

function uploadRequest(attemptId: string): NextRequest {
  const auth = authentication();
  const form = new FormData();
  form.set('csrfToken', auth.csrfToken);
  form.set('attemptId', attemptId);
  form.set('altText', 'اتاق روشن درمانگاه');
  form.set('file', new Blob(['synthetic-photo'], { type: 'image/jpeg' }), 'phone-photo.jpg');
  return new NextRequest(`${ORIGIN}/api/media/upload`, {
    method: 'POST',
    headers: { origin: ORIGIN, cookie: auth.cookie },
    body: form,
  });
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.uploadMedia.mockResolvedValue({ ok: true, data: { media: MEDIA } });
  mocks.createMediaAttachment.mockResolvedValue({ ok: true, data: { media: MEDIA } });
  mocks.getMedia.mockResolvedValue({ ok: true, data: { media: MEDIA } });
  mocks.updateMediaFraming.mockResolvedValue({ ok: true, data: { media: MEDIA } });
  mocks.updateMediaPublication.mockResolvedValue({ ok: true, data: { media: MEDIA } });
});

describe('media upload route', () => {
  it('memoises a successful attempt so a retry does not create a duplicate', async () => {
    const attempt = crypto.randomUUID();
    const first = await uploadMedia(uploadRequest(attempt));
    const retry = await uploadMedia(uploadRequest(attempt));

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(mocks.uploadMedia).toHaveBeenCalledTimes(1);
  });

  it('does not create a second asset when attachment fails after upload and the user retries', async () => {
    const attempt = crypto.randomUUID();
    const uploaded = await uploadMedia(uploadRequest(attempt));
    expect(uploaded.status).toBe(201);

    mocks.createMediaAttachment.mockResolvedValueOnce({
      ok: false,
      code: 'API_UNREACHABLE',
      status: 503,
    });
    const failedAttachment = await attachDraft(
      jsonRequest('/api/media/draft-attachment', { mediaId: MEDIA_ID }),
    );
    expect(failedAttachment.status).toBe(503);

    const retriedUpload = await uploadMedia(uploadRequest(attempt));
    const retriedAttachment = await attachDraft(
      jsonRequest('/api/media/draft-attachment', { mediaId: MEDIA_ID }),
    );

    expect(retriedUpload.status).toBe(201);
    expect(retriedAttachment.status).toBe(201);
    expect(mocks.uploadMedia).toHaveBeenCalledTimes(1);
    expect(mocks.createMediaAttachment).toHaveBeenCalledTimes(2);
  });

  it('returns a photograph-oriented Persian refusal from A5', async () => {
    mocks.uploadMedia.mockResolvedValueOnce({
      ok: false,
      code: 'MEDIA_TYPE_UNSUPPORTED',
      status: 415,
    });
    const response = await uploadMedia(uploadRequest(crypto.randomUUID()));
    const body = await response.json();

    expect(response.status).toBe(415);
    expect(body.error.message).toContain('عکس');
    expect(body.error.message).toContain('انتخاب کنید');
    expect(body.error.message).not.toMatch(/HEIC|codec|format/i);
  });
});

describe('attachment and framing routes', () => {
  it('passes a public-space owner through the reusable draft attachment route', async () => {
    const spaceId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a62';
    mocks.createMediaAttachment.mockResolvedValueOnce({
      ok: true,
      data: {
        media: {
          ...MEDIA,
          attachments: [
            {
              ...MEDIA.attachments[0],
              ownerType: 'PUBLIC_SPACE',
              ownerId: spaceId,
              position: 1,
            },
          ],
        },
      },
    });
    const response = await attachDraft(
      jsonRequest('/api/media/draft-attachment', {
        mediaId: MEDIA_ID,
        ownerType: 'PUBLIC_SPACE',
        ownerId: spaceId,
        position: 1,
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.createMediaAttachment).toHaveBeenCalledWith(
      MEDIA_ID,
      { ownerType: 'PUBLIC_SPACE', ownerId: spaceId, position: 1 },
      { sessionToken: SESSION_TOKEN },
    );
  });

  it('passes a therapist portrait owner through the reusable draft attachment route', async () => {
    const therapistId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a60';
    mocks.createMediaAttachment.mockResolvedValueOnce({
      ok: true,
      data: {
        media: {
          ...MEDIA,
          attachments: [
            {
              ...MEDIA.attachments[0],
              ownerType: 'THERAPIST_PROFILE',
              ownerId: therapistId,
            },
          ],
        },
      },
    });
    const response = await attachDraft(
      jsonRequest('/api/media/draft-attachment', {
        mediaId: MEDIA_ID,
        ownerType: 'THERAPIST_PROFILE',
        ownerId: therapistId,
        position: 0,
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.createMediaAttachment).toHaveBeenCalledWith(
      MEDIA_ID,
      { ownerType: 'THERAPIST_PROFILE', ownerId: therapistId, position: 0 },
      { sessionToken: SESSION_TOKEN },
    );
  });

  it('passes a fixed clinic content entry owner through the reusable draft attachment route', async () => {
    const entryId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a61';
    mocks.createMediaAttachment.mockResolvedValueOnce({
      ok: true,
      data: {
        media: {
          ...MEDIA,
          attachments: [
            {
              ...MEDIA.attachments[0],
              ownerType: 'CLINIC_CONTENT_ENTRY',
              ownerId: entryId,
            },
          ],
        },
      },
    });
    const response = await attachDraft(
      jsonRequest('/api/media/draft-attachment', {
        mediaId: MEDIA_ID,
        ownerType: 'CLINIC_CONTENT_ENTRY',
        ownerId: entryId,
        position: 0,
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.createMediaAttachment).toHaveBeenCalledWith(
      MEDIA_ID,
      { ownerType: 'CLINIC_CONTENT_ENTRY', ownerId: entryId, position: 0 },
      { sessionToken: SESSION_TOKEN },
    );
  });

  it('passes the ownerless clinic open-graph target through the reusable route', async () => {
    mocks.createMediaAttachment.mockResolvedValueOnce({
      ok: true,
      data: {
        media: {
          ...MEDIA,
          attachments: [
            {
              ...MEDIA.attachments[0],
              ownerType: 'CLINIC_OPEN_GRAPH',
              ownerId: null,
            },
          ],
        },
      },
    });
    const response = await attachDraft(
      jsonRequest('/api/media/draft-attachment', {
        mediaId: MEDIA_ID,
        ownerType: 'CLINIC_OPEN_GRAPH',
        ownerId: null,
        position: 0,
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.createMediaAttachment).toHaveBeenCalledWith(
      MEDIA_ID,
      { ownerType: 'CLINIC_OPEN_GRAPH', ownerId: null, position: 0 },
      { sessionToken: SESSION_TOKEN },
    );
  });

  it('recovers an already-created draft attachment instead of re-uploading', async () => {
    mocks.createMediaAttachment.mockResolvedValueOnce({
      ok: false,
      code: 'MEDIA_ALREADY_ATTACHED',
      status: 409,
    });
    const response = await attachDraft(
      jsonRequest('/api/media/draft-attachment', { mediaId: MEDIA_ID }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.attachmentId).toBe(ATTACHMENT_ID);
    expect(mocks.getMedia).toHaveBeenCalledWith(MEDIA_ID, { sessionToken: SESSION_TOKEN });
    expect(mocks.uploadMedia).not.toHaveBeenCalled();
  });

  it('round-trips the exact normalised framing and explains a published refusal', async () => {
    const framing = {
      attachmentId: ATTACHMENT_ID,
      focalX: 0.25,
      focalY: 0.4,
      cropX: 0,
      cropY: 0.1,
      cropWidth: 1,
      cropHeight: 0.5625,
    };
    await saveFraming(jsonRequest('/api/media/framing', framing));
    expect(mocks.updateMediaFraming).toHaveBeenCalledWith(
      ATTACHMENT_ID,
      {
        focalX: 0.25,
        focalY: 0.4,
        crop: { x: 0, y: 0.1, width: 1, height: 0.5625 },
      },
      { sessionToken: SESSION_TOKEN },
    );

    mocks.updateMediaFraming.mockResolvedValueOnce({
      ok: false,
      code: 'MEDIA_ATTACHMENT_PUBLISHED',
      status: 409,
    });
    const refused = await saveFraming(jsonRequest('/api/media/framing', framing));
    const body = await refused.json();
    expect(refused.status).toBe(409);
    expect(body.error.message).toContain('مدیر');
    expect(body.error.message).toContain('قاب');
  });

  it('publishes a public-space photograph and returns to its editor', async () => {
    const spaceId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a62';
    const response = await setPublication(
      jsonRequest('/api/media/publication', {
        attachmentId: ATTACHMENT_ID,
        spaceId,
        isPublished: 'true',
      }),
    );

    expect(mocks.updateMediaPublication).toHaveBeenCalledWith(
      ATTACHMENT_ID,
      { isPublished: true },
      { sessionToken: SESSION_TOKEN },
    );
    expect(response.headers.get('location')).toBe(
      `${ORIGIN}/content/spaces/${spaceId}/edit?success=space-photo-published`,
    );
  });
});
