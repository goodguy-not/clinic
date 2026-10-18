import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

afterEach(() => vi.unstubAllGlobals());

describe('Web readiness', () => {
  it('checks API readiness and returns only a public status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'ok',
          checks: { database: 'ok', media: 'ok' },
          secret: 'internal-detail',
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET();
    expect(new URL(fetchMock.mock.calls[0]![0]).pathname).toBe('/health/ready');
    expect(fetchMock.mock.calls[0]![1].cache).toBe('no-store');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('reports unavailable without exposing backend details', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response('database unavailable at private-host', { status: 503 })),
    );
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable' });
  });
});
