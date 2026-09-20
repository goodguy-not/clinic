import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MEDIA_PREVIEW_CACHE_CONTROL } from '@clinic/contracts';
import { cookieConfigFor } from '@/server/cookie-config';
import { signSessionCookie } from '@/server/session-cookie';
import { GET } from './route';

const ORIGIN = 'http://localhost:3000';
const SECRET = process.env['SESSION_COOKIE_SECRET'] as string;
const SESSION_TOKEN = 'synthetic-preview-session';
const RENDITION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4da1';
const COOKIES = cookieConfigFor('non-production');

function request(authenticated = true): NextRequest {
  return new NextRequest(`${ORIGIN}/api/media/renditions/${RENDITION_ID}/preview`, {
    headers: authenticated
      ? {
          cookie: `${COOKIES.session.name}=${signSessionCookie(SECRET, SESSION_TOKEN)}`,
        }
      : {},
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('authenticated persisted-media preview', () => {
  it('refuses before an upstream request when there is no signed staff session', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(request(false), {
      params: Promise.resolve({ renditionId: RENDITION_ID }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe(MEDIA_PREVIEW_CACHE_CONTROL);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses only the staff endpoint, forwards the opaque session, and never caches', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        captured = { url, init };
        return Promise.resolve(
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: {
              'content-type': 'image/webp',
              'content-length': '3',
              'cache-control': MEDIA_PREVIEW_CACHE_CONTROL,
              etag: '"must-not-pass-through"',
              'x-content-type-options': 'nosniff',
              'content-disposition': 'inline',
            },
          }),
        );
      }),
    );

    const response = await GET(request(), {
      params: Promise.resolve({ renditionId: RENDITION_ID }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(MEDIA_PREVIEW_CACHE_CONTROL);
    expect(response.headers.get('etag')).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(new URL(captured!.url).pathname).toBe(`/media/renditions/${RENDITION_ID}/preview`);
    expect(new URL(captured!.url).pathname).not.toContain('/public/media');
    expect(captured!.init.cache).toBe('no-store');
    expect(captured!.init).not.toHaveProperty('next');
    expect((captured!.init.headers as Headers).get('x-session-id')).toBe(SESSION_TOKEN);
  });

  it('does not fall back to public media when the staff preview refuses', async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(new Response(null, { status: 404 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(request(), {
      params: Promise.resolve({ renditionId: RENDITION_ID }),
    });

    expect(response.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('/public/media');
  });
});
