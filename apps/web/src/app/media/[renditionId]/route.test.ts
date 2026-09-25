import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4da1';

afterEach(() => vi.unstubAllGlobals());

describe('same-origin public media route', () => {
  it('transports bytes without retaining an authorization decision', async () => {
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
              etag: '"synthetic"',
              'cache-control': 'public, max-age=300, s-maxage=300, must-revalidate',
              'x-content-type-options': 'nosniff',
              'content-disposition': 'inline',
            },
          }),
        );
      }),
    );

    const response = await GET(new NextRequest(`http://localhost:3000/media/${ID}`), {
      params: Promise.resolve({ renditionId: ID }),
    });

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(response.headers.get('cache-control')).toBe(
      'private, no-store, max-age=0, must-revalidate',
    );
    expect(response.headers.get('etag')).toBe('"synthetic"');
    expect(new URL(captured!.url).pathname).toBe(`/public/media/${ID}`);
    expect(captured!.init.cache).toBe('no-store');
    expect(captured!.init).not.toHaveProperty('next');
  });

  it('does not reuse a prior success after the API revokes a rendition', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/webp' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const first = await GET(new NextRequest(`http://localhost:3000/media/${ID}`), {
      params: Promise.resolve({ renditionId: ID }),
    });
    const revoked = await GET(new NextRequest(`http://localhost:3000/media/${ID}`), {
      params: Promise.resolve({ renditionId: ID }),
    });

    expect(first.status).toBe(200);
    expect(revoked.status).toBe(404);
    expect(revoked.headers.get('cache-control')).toBe('no-store');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('turns every invalid or upstream refusal into the same non-cacheable 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 404 }))),
    );
    const invalid = await GET(new NextRequest('http://localhost:3000/media/not-an-id'), {
      params: Promise.resolve({ renditionId: 'not-an-id' }),
    });
    const refused = await GET(new NextRequest(`http://localhost:3000/media/${ID}`), {
      params: Promise.resolve({ renditionId: ID }),
    });

    expect(invalid.status).toBe(404);
    expect(refused.status).toBe(404);
    expect(invalid.headers.get('cache-control')).toBe('no-store');
    expect(await refused.json()).toMatchObject({ error: { code: 'MEDIA_NOT_FOUND' } });
  });
});
