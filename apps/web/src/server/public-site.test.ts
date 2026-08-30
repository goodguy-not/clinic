import { afterEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_CACHE_TAGS } from '@clinic/contracts';
import {
  getPublicArticle,
  getPublicArticles,
  getPublicHomeData,
  getPublicService,
  getPublicTeam,
  getPublicTestimonials,
  getPublicTherapist,
} from './public-site';

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
    ).toEqual(
      expect.arrayContaining([
        PUBLIC_CACHE_TAGS.clinicProfile,
        PUBLIC_CACHE_TAGS.services,
        PUBLIC_CACHE_TAGS.team,
      ]),
    );
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
        },
      },
      '/public/articles': {
        articles: [
          {
            slug: 'first-visit',
            title: 'جلسهٔ اول',
            summary: null,
            publishedAt: '2026-08-01T08:00:00.000Z',
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
        },
      },
      '/public/testimonials': { testimonials: [{ authorLabel: null, body: 'روایت تأییدشده' }] },
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
    expect(testimonials.data).toEqual([{ authorLabel: null, body: 'روایت تأییدشده' }]);
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
