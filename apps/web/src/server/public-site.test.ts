import { afterEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_CACHE_TAGS } from '@clinic/contracts';
import { getPublicHomeData } from './public-site';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('public website reads', () => {
  it('uses only the A1 public routes, strict projections, and frozen cache tags', async () => {
    const responses: Record<string, unknown> = {
      '/public/clinic-profile': { clinic: emptyClinic() },
      '/public/services': {
        services: [{ slug: 'speech-therapy', name: 'گفتاردرمانی', description: null }],
      },
      '/public/team': {
        therapists: [
          {
            slug: 'sample-therapist',
            displayName: 'درمانگر نمونه',
            title: null,
            bio: null,
            photoPath: null,
          },
        ],
      },
    };
    const fetchSpy = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = new URL(String(input));
      return Response.json(responses[url.pathname]);
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await getPublicHomeData();

    expect(result.services.data[0]?.slug).toBe('speech-therapy');
    expect(result.team.data[0]?.displayName).toBe('درمانگر نمونه');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const calls = fetchSpy.mock.calls as [string, RequestInit][];
    expect(calls.map(([url]) => new URL(url).pathname).sort()).toEqual([
      '/public/clinic-profile',
      '/public/services',
      '/public/team',
    ]);
    expect(calls.every(([, init]) => init.cache === 'force-cache')).toBe(true);
    expect(
      calls.map(([, init]) => (init as RequestInit & { next: { tags: string[] } }).next.tags[0]),
    ).toEqual(expect.arrayContaining(Object.values(PUBLIC_CACHE_TAGS)));
    expect(calls.every(([, init]) => !('x-session-id' in (init.headers as object)))).toBe(true);
  });

  it('fails closed to deliberate empty public states', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ privateField: 'must not pass' })),
    );

    const result = await getPublicHomeData();

    expect(result.clinic.status).toBe('unavailable');
    expect(result.clinic.data.displayName).toBeNull();
    expect(result.services.data).toEqual([]);
    expect(result.team.data).toEqual([]);
  });
});

function emptyClinic() {
  return {
    displayName: null,
    tagline: null,
    about: null,
    addressLine: null,
    cityLabel: null,
    phonePrimary: null,
    phoneSecondary: null,
    email: null,
    workingHoursNote: null,
    mapLatitude: null,
    mapLongitude: null,
    instagramUrl: null,
    telegramUrl: null,
  };
}
