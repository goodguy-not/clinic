import { afterEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_CACHE_TAGS } from '@clinic/contracts';
import {
  getPublicArticle,
  getPublicArticles,
  getPublicHomeData,
  getPublicClinicContent,
  getPublicService,
  getPublicSpaces,
  getPublicTeam,
  getPublicTestimonials,
  getPublicTherapist,
  submitPublicRequest,
} from './public-site';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('public website reads', () => {
  it('uses only the A1 public routes, strict projections, and frozen cache tags', async () => {
    const responses: Record<string, unknown> = {
      '/public/clinic-profile': { clinic: emptyClinic() },
      '/public/clinic-content': { openGraphImage: null, entries: [] },
      '/public/spaces': { spaces: [] },
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
            // Milestone 9.5: an uploaded portrait, or null. Never absent.
            photo: null,
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
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    const calls = fetchSpy.mock.calls as [string, RequestInit][];
    expect(calls.map(([url]) => new URL(url).pathname).sort()).toEqual([
      '/public/clinic-content',
      '/public/clinic-profile',
      '/public/services',
      '/public/spaces',
      '/public/team',
    ]);
    expect(calls.every(([, init]) => init.cache === 'force-cache')).toBe(true);
    expect(
      calls.map(([, init]) => (init as RequestInit & { next: { tags: string[] } }).next.tags[0]),
    ).toEqual(
      expect.arrayContaining([
        PUBLIC_CACHE_TAGS.clinicProfile,
        PUBLIC_CACHE_TAGS.spaces,
        PUBLIC_CACHE_TAGS.services,
        PUBLIC_CACHE_TAGS.team,
      ]),
    );
    expect(calls.every(([, init]) => !('x-session-id' in (init.headers as object)))).toBe(true);
    expect(calls.every(([, init]) => !('x-request-id' in (init.headers as object)))).toBe(true);
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

  it('parses every A2 content read through its purpose-built projection', async () => {
    const responses: Record<string, unknown> = {
      '/public/services/speech-therapy': {
        service: {
          slug: 'speech-therapy',
          name: 'گفتاردرمانی',
          description: null,
          sessionDurationsMinutes: [45],
        },
      },
      '/public/team': { therapists: [] },
      '/public/team/public-person': {
        therapist: {
          slug: 'public-person',
          displayName: 'درمانگر عمومی',
          title: null,
          bio: null,
          photoPath: null,
          photo: null,
        },
      },
      '/public/articles': {
        articles: [
          {
            slug: 'first-visit',
            title: 'جلسهٔ اول',
            summary: null,
            publishedAt: '2026-08-01T08:00:00.000Z',
            images: [],
          },
        ],
      },
      '/public/articles/first-visit': {
        article: {
          slug: 'first-visit',
          title: 'جلسهٔ اول',
          summary: null,
          publishedAt: '2026-08-01T08:00:00.000Z',
          body: 'متن تأییدشده',
          images: [],
        },
      },
      '/public/testimonials': {
        testimonials: [{ authorLabel: null, body: 'روایت تأییدشده', kind: 'TYPED', image: null }],
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname;
        return Response.json(responses[path]);
      }),
    );

    const [service, team, therapist, articles, article, testimonials] = await Promise.all([
      getPublicService('speech-therapy'),
      getPublicTeam(),
      getPublicTherapist('public-person'),
      getPublicArticles(),
      getPublicArticle('first-visit'),
      getPublicTestimonials(),
    ]);

    expect(service.status === 'ready' && service.data.sessionDurationsMinutes).toEqual([45]);
    expect(team.data).toEqual([]);
    expect(therapist.status === 'ready' && therapist.data.displayName).toBe('درمانگر عمومی');
    expect(articles.data).toHaveLength(1);
    expect(article.status === 'ready' && article.data.body).toBe('متن تأییدشده');
    expect(testimonials.data).toEqual([
      { authorLabel: null, body: 'روایت تأییدشده', kind: 'TYPED', image: null },
    ]);
  });

  it('reads A8 content and A7 spaces only through their strict public projections', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path === '/public/clinic-content') {
        return Response.json({
          openGraphImage: null,
          entries: [
            {
              slot: 'HOME_HERO',
              label: null,
              eyebrow: 'معرفی نمونه',
              heading: 'عنوان مدیریت‌شده',
              body: 'متن مدیریت‌شده',
              image: null,
            },
          ],
        });
      }
      return Response.json({
        spaces: [{ name: 'فضای منتشرشده', description: 'توضیح منتشرشده', images: [] }],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const [content, spaces] = await Promise.all([getPublicClinicContent(), getPublicSpaces()]);
    expect(content.data.entries.map((entry) => entry.heading)).toEqual(['عنوان مدیریت‌شده']);
    expect(spaces.data).toEqual([
      { name: 'فضای منتشرشده', description: 'توضیح منتشرشده', images: [] },
    ]);
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname).sort()).toEqual([
      '/public/clinic-content',
      '/public/spaces',
    ]);
  });

  it('fails closed when a supposed public space carries operational room data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          spaces: [
            {
              name: 'فضای ناسالم',
              description: null,
              images: [],
              roomId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d70',
              status: 'ACTIVE',
              capacity: 3,
            },
          ],
        }),
      ),
    );

    await expect(getPublicSpaces()).resolves.toEqual({ status: 'unavailable', data: [] });
  });

  it('distinguishes a private-or-missing detail from a transport failure without exposing why', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname;
        return path.endsWith('/private-service')
          ? new Response(null, { status: 404 })
          : new Response(null, { status: 503 });
      }),
    );

    await expect(getPublicService('private-service')).resolves.toEqual({
      status: 'not-found',
      data: null,
    });
    await expect(getPublicService('temporarily-down')).resolves.toEqual({
      status: 'unavailable',
      data: null,
    });
  });
});

describe('public request write boundary', () => {
  const submission = {
    contactName: 'والد نمونه',
    contactMobile: '09121234567',
    serviceSlug: null,
    childAgeYears: 13,
    childSex: 'UNSPECIFIED' as const,
    consent: true as const,
    consentVersion: '2026-08-27' as const,
  };

  it('posts only to A3 with the internal key and parses the neutral success', async () => {
    const fetchSpy = vi.fn(async () => Response.json({ received: true }, { status: 202 }));
    vi.stubGlobal('fetch', fetchSpy);

    await expect(submitPublicRequest(submission, { clientIp: '203.0.113.10' })).resolves.toEqual({
      ok: true,
    });

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/public/requests');
    expect(init.method).toBe('POST');
    expect(init.cache).toBe('no-store');
    const headers = init.headers as Headers;
    expect(headers.get('x-internal-key')).toBeTruthy();
    expect(headers.get('x-request-id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(headers.get('x-client-ip')).toBe('203.0.113.10');
    expect(headers.has('x-session-id')).toBe(false);
    expect(JSON.parse(String(init.body))).toEqual(submission);
  });

  it('keeps duplicate success indistinguishable and refuses widened success shapes', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ received: true }, { status: 202 }))
        .mockResolvedValueOnce(Response.json({ received: true, duplicate: true }, { status: 202 })),
    );

    await expect(submitPublicRequest(submission, { clientIp: null })).resolves.toEqual({
      ok: true,
    });
    await expect(submitPublicRequest(submission, { clientIp: null })).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it.each([
    [429, 'PUBLIC_REQUEST_THROTTLED', 'throttled'],
    [404, 'SERVICE_NOT_FOUND', 'service-context'],
    [400, 'VALIDATION_FAILED', 'invalid'],
    [503, 'INTERNAL_ERROR', 'unavailable'],
  ] as const)('maps %s/%s without leaking the API message', async (status, code, reason) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { code, message: 'internal detail', requestId: crypto.randomUUID() } },
          { status },
        ),
      ),
    );

    await expect(submitPublicRequest(submission, { clientIp: null })).resolves.toEqual({
      ok: false,
      reason,
    });
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
