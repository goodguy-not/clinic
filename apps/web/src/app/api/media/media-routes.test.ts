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
  updateMediaAltText: vi.fn(),
  updateMediaArchive: vi.fn(),
  updateMediaPublication: vi.fn(),
}));
const { invalidateMediaPublication, invalidateMediaArchive } = vi.hoisted(() => ({
  invalidateMediaPublication: vi.fn(),
  invalidateMediaArchive: vi.fn(),
}));
vi.mock('@/server/api-client', () => ({ api: mocks }));
vi.mock('@/server/public-cache-invalidation', () => ({
  invalidateMediaPublication,
  invalidateMediaArchive,
}));

import { POST as attachDraft } from './draft-attachment/route';
import { POST as saveFraming } from './framing/route';
import { POST as updateAltText } from './alt-text/route';
import { POST as updateArchive } from './archive/route';
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

function uploadRequest(): NextRequest {
  const auth = authentication();
  const form = new FormData();
  form.set('csrfToken', auth.csrfToken);
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
  invalidateMediaPublication.mockReset();
  invalidateMediaArchive.mockReset();
  mocks.uploadMedia.mockResolvedValue({ ok: true, data: { media: MEDIA } });
  mocks.createMediaAttachment.mockResolvedValue({ ok: true, data: { media: MEDIA } });
  mocks.getMedia.mockResolvedValue({ ok: true, data: { media: MEDIA } });
  mocks.updateMediaFraming.mockResolvedValue({ ok: true, data: { media: MEDIA } });
  mocks.updateMediaAltText.mockResolvedValue({
    ok: true,
    data: { media: { ...MEDIA, altText: 'توضیح اصلاح‌شده' }, publications: [] },
  });
  mocks.updateMediaPublication.mockResolvedValue({
    ok: true,
    data: {
      media: MEDIA,
      publication: {
        attachmentId: ATTACHMENT_ID,
        ownerType: 'CLINIC_SPACE',
        ownerId: null,
        publicSlug: null,
        ownerIsPublic: false,
        renditionIds: [],
      },
    },
  });
  mocks.updateMediaArchive.mockResolvedValue({ ok: true, data: { media: MEDIA } });
});

describe('media archive route', () => {
  it('lets a manager archive an asset and expires every public owner view', async () => {
    const response = await updateArchive(
      jsonRequest('/api/media/archive', { mediaId: MEDIA_ID, archived: 'true' }),
    );

    expect(mocks.updateMediaArchive).toHaveBeenCalledWith(
      MEDIA_ID,
      { archived: true },
      { sessionToken: SESSION_TOKEN },
    );
    expect(invalidateMediaArchive).toHaveBeenCalledOnce();
    expect(response.headers.get('location')).toBe(`/media?success=archived`);
  });

  it('restores an asset without implicitly publishing any attachment', async () => {
    const response = await updateArchive(
      jsonRequest('/api/media/archive', { mediaId: MEDIA_ID, archived: 'false' }),
    );

    expect(mocks.updateMediaArchive).toHaveBeenCalledWith(
      MEDIA_ID,
      { archived: false },
      { sessionToken: SESSION_TOKEN },
    );
    expect(response.headers.get('location')).toBe(`/media?success=restored`);
  });
});

describe('media upload route', () => {
  it('delegates retries to A5 durable same-user byte identity', async () => {
    const first = await uploadMedia(uploadRequest());
    const retry = await uploadMedia(uploadRequest());

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(await first.json()).toEqual(await retry.json());
    expect(mocks.uploadMedia).toHaveBeenCalledTimes(2);
  });

  it('gets the same asset back when attachment recovery begins with an upload retry', async () => {
    const uploaded = await uploadMedia(uploadRequest());
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

    const retriedUpload = await uploadMedia(uploadRequest());
    const retriedAttachment = await attachDraft(
      jsonRequest('/api/media/draft-attachment', { mediaId: MEDIA_ID }),
    );

    expect(retriedUpload.status).toBe(201);
    expect(retriedAttachment.status).toBe(201);
    expect(await retriedUpload.json()).toEqual({ media: MEDIA });
    expect(mocks.uploadMedia).toHaveBeenCalledTimes(2);
    expect(mocks.createMediaAttachment).toHaveBeenCalledTimes(2);
  });

  it('invites a retry in Persian when the upload service genuinely fails', async () => {
    mocks.uploadMedia.mockResolvedValueOnce({
      ok: false,
      code: 'API_UNREACHABLE',
      status: 503,
    });
    const response = await uploadMedia(uploadRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.message).toContain('دوباره تلاش کنید');
  });

  it('returns a photograph-oriented Persian refusal from A5', async () => {
    mocks.uploadMedia.mockResolvedValueOnce({
      ok: false,
      code: 'MEDIA_TYPE_UNSUPPORTED',
      status: 415,
    });
    const response = await uploadMedia(uploadRequest());
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

  it('passes the service image owner through the reusable draft attachment route', async () => {
    const serviceId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a66';
    mocks.createMediaAttachment.mockResolvedValueOnce({
      ok: true,
      data: {
        media: {
          ...MEDIA,
          attachments: [
            {
              ...MEDIA.attachments[0],
              ownerType: 'PUBLIC_SERVICE',
              ownerId: serviceId,
            },
          ],
        },
      },
    });
    const response = await attachDraft(
      jsonRequest('/api/media/draft-attachment', {
        mediaId: MEDIA_ID,
        ownerType: 'PUBLIC_SERVICE',
        ownerId: serviceId,
        position: 0,
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.createMediaAttachment).toHaveBeenCalledWith(
      MEDIA_ID,
      { ownerType: 'PUBLIC_SERVICE', ownerId: serviceId, position: 0 },
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
      `/content/spaces/${spaceId}/edit?success=space-photo-published`,
    );
    expect(invalidateMediaPublication).toHaveBeenCalledWith(
      expect.objectContaining({ attachmentId: ATTACHMENT_ID, ownerType: 'CLINIC_SPACE' }),
    );
  });

  it('publishes a service photograph and returns to the service editor', async () => {
    const serviceId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a66';
    const response = await setPublication(
      jsonRequest('/api/media/publication', {
        attachmentId: ATTACHMENT_ID,
        serviceId,
        isPublished: 'true',
      }),
    );

    expect(mocks.updateMediaPublication).toHaveBeenCalledWith(
      ATTACHMENT_ID,
      { isPublished: true },
      { sessionToken: SESSION_TOKEN },
    );
    expect(response.headers.get('location')).toBe(
      `/content/services/${serviceId}?success=service-image-published`,
    );
  });

  it('publishes an article photograph and returns to the article editor', async () => {
    const articleId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a63';
    const response = await setPublication(
      jsonRequest('/api/media/publication', {
        attachmentId: ATTACHMENT_ID,
        articleId,
        isPublished: 'true',
      }),
    );

    expect(mocks.updateMediaPublication).toHaveBeenCalledWith(
      ATTACHMENT_ID,
      { isPublished: true },
      { sessionToken: SESSION_TOKEN },
    );
    expect(response.headers.get('location')).toBe(
      `/content/articles/${articleId}/edit?success=article-image-published`,
    );
  });

  it('publishes a handwritten-testimonial photograph and returns to its review', async () => {
    const testimonialId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a64';
    const response = await setPublication(
      jsonRequest('/api/media/publication', {
        attachmentId: ATTACHMENT_ID,
        testimonialId,
        isPublished: 'true',
      }),
    );

    expect(mocks.updateMediaPublication).toHaveBeenCalledWith(
      ATTACHMENT_ID,
      { isPublished: true },
      { sessionToken: SESSION_TOKEN },
    );
    expect(response.headers.get('location')).toBe(
      `/content/testimonials/${testimonialId}/edit?success=testimonial-image-published`,
    );
  });
});

describe('photo description correction route', () => {
  it('lets the API accept a draft correction and returns to the exact editor', async () => {
    const articleId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a63';
    const response = await updateAltText(
      jsonRequest('/api/media/alt-text', {
        mediaId: MEDIA_ID,
        articleId,
        altText: 'توضیح اصلاح‌شده',
      }),
    );

    expect(mocks.updateMediaAltText).toHaveBeenCalledWith(
      MEDIA_ID,
      { altText: 'توضیح اصلاح‌شده' },
      { sessionToken: SESSION_TOKEN },
    );
    expect(response.headers.get('location')).toBe(
      `/content/articles/${articleId}/edit?success=photo-description-corrected`,
    );
    expect(invalidateMediaPublication).not.toHaveBeenCalled();
  });

  it('invalidates every publication returned after a manager changes a public photo', async () => {
    const first = {
      attachmentId: ATTACHMENT_ID,
      ownerType: 'THERAPIST_PROFILE',
      ownerId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a60',
      publicSlug: 'synthetic-therapist',
      ownerIsPublic: true,
      renditionIds: ['0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d93'],
    } as const;
    const second = {
      attachmentId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d94',
      ownerType: 'PUBLIC_ARTICLE',
      ownerId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d95',
      publicSlug: 'shared-photo',
      ownerIsPublic: true,
      renditionIds: ['0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d93'],
    } as const;
    mocks.updateMediaAltText.mockResolvedValueOnce({
      ok: true,
      data: { media: MEDIA, publications: [first, second] },
    });

    await updateAltText(
      jsonRequest('/api/media/alt-text', {
        mediaId: MEDIA_ID,
        therapistId: first.ownerId,
        altText: 'توضیح تازه در همهٔ صفحه‌ها',
      }),
    );

    expect(invalidateMediaPublication.mock.calls).toEqual([[first], [second]]);
  });

  it('turns an API authority refusal into a photo-specific Persian page message', async () => {
    mocks.updateMediaAltText.mockResolvedValueOnce({
      ok: false,
      code: 'AUTH_FORBIDDEN',
      status: 403,
    });

    const response = await updateAltText(
      jsonRequest('/api/media/alt-text', {
        mediaId: MEDIA_ID,
        mediaLibrary: 'true',
        altText: 'تغییر پذیرش روی عکس عمومی',
      }),
    );

    expect(response.headers.get('location')).toBe(`/media?error=MEDIA_ALT_TEXT_MANAGER_REQUIRED`);
  });

  it('refuses an invalid description before calling NestJS with photo-specific wording', async () => {
    const response = await updateAltText(
      jsonRequest('/api/media/alt-text', {
        mediaId: MEDIA_ID,
        mediaLibrary: 'true',
        altText: '   ',
      }),
    );

    expect(response.headers.get('location')).toBe(`/media?error=MEDIA_ALT_TEXT_INVALID`);
    expect(mocks.updateMediaAltText).not.toHaveBeenCalled();
  });
});
