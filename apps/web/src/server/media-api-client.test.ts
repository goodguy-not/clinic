import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api-client';

const MEDIA_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d81';
const ATTACHMENT_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d82';
const FRAMING = {
  focalX: 0.25,
  focalY: 0.4,
  crop: { x: 0, y: 0.1, width: 1, height: 0.5625 },
};
const MEDIA = {
  id: MEDIA_ID,
  altText: 'عکس ساختگی اتاق درمان',
  status: 'ACTIVE',
  width: 2560,
  height: 1920,
  byteSize: 500_000,
  sourceContentType: 'image/jpeg',
  sourceByteSize: 4_000_000,
  isPubliclyServed: false,
  renditions: [],
  attachments: [
    {
      id: ATTACHMENT_ID,
      ownerType: 'CLINIC_SPACE',
      ownerId: null,
      position: 0,
      attachedAt: '2026-09-09T08:00:00.000Z',
      publishedAt: null,
      ownerIsPublic: true,
      framing: FRAMING,
    },
  ],
  createdAt: '2026-09-09T08:00:00.000Z',
  archivedAt: null,
  bytesPurgedAt: null,
};

type Captured = { url: string; init: RequestInit };
let captured: Captured[] = [];

beforeEach(() => {
  captured = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      captured.push({ url, init });
      return Promise.resolve(
        new Response(JSON.stringify({ media: MEDIA }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('named A5 media client', () => {
  it('forwards a photograph as multipart without inventing a content-type boundary', async () => {
    await api.uploadMedia(new Blob(['synthetic'], { type: 'image/jpeg' }), MEDIA.altText, {
      sessionToken: 'synthetic-token',
    });

    const request = captured[0]!;
    expect(new URL(request.url).pathname).toBe('/media');
    expect(request.init.method).toBe('POST');
    expect(request.init.body).toBeInstanceOf(FormData);
    expect((request.init.headers as Headers).has('content-type')).toBe(false);
    const form = request.init.body as FormData;
    expect(form.get('altText')).toBe(MEDIA.altText);
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('keeps attachment and framing as separate exact A5 writes', async () => {
    await api.createMediaAttachment(
      MEDIA_ID,
      { ownerType: 'CLINIC_SPACE', ownerId: null, position: 0 },
      { sessionToken: 'synthetic-token' },
    );
    await api.updateMediaFraming(ATTACHMENT_ID, FRAMING, {
      sessionToken: 'synthetic-token',
    });

    expect(captured.map((entry) => [entry.init.method, new URL(entry.url).pathname])).toEqual([
      ['POST', `/media/${MEDIA_ID}/attachments`],
      ['PATCH', `/media/attachments/${ATTACHMENT_ID}/framing`],
    ]);
    expect(JSON.parse(String(captured[0]?.init.body))).toEqual({
      ownerType: 'CLINIC_SPACE',
      ownerId: null,
      position: 0,
    });
    expect(JSON.parse(String(captured[1]?.init.body))).toEqual(FRAMING);
  });
});
