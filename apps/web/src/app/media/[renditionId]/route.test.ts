import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4da1';

afterEach(() => vi.unstubAllGlobals());

describe('same-origin public media route', () => {
  it('transports bytes and pins the accepted five-minute cache tag', async () => {
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
      'public, max-age=300, s-maxage=300, must-revalidate',
    );
    expect(response.headers.get('etag')).toBe('"synthetic"');
    expect(new URL(captured!.url).pathname).toBe(`/public/media/${ID}`);
    expect((captured!.init.next as { revalidate: number; tags: string[] }).revalidate).toBe(300);
    expect((captured!.init.next as { revalidate: number; tags: string[] }).tags).toEqual([
      `public-media:${ID}`,
    ]);
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
