import 'server-only';
import { randomUUID } from 'node:crypto';
import {
  PUBLIC_CACHE_TAGS,
  PUBLIC_ARTICLE_CACHE_TAG_PREFIX,
  PUBLIC_SERVICE_CACHE_TAG_PREFIX,
  PUBLIC_THERAPIST_CACHE_TAG_PREFIX,
  publicArticleDetailResponseSchema,
  publicArticleListResponseSchema,
  publicClinicProfileResponseSchema,
  publicServiceDetailResponseSchema,
  publicServiceListResponseSchema,
  publicSitemapResponseSchema,
  publicTeamResponseSchema,
  publicTestimonialListResponseSchema,
  publicTherapistProfileResponseSchema,
  type PublicArticleDetail,
  type PublicArticleSummary,
  type PublicClinicProfile,
  type PublicServiceDetail,
  type PublicServiceSummary,
  type PublicSitemapEntry,
  type PublicTestimonial,
  type PublicTherapistProfile,
} from '@clinic/contracts';
import { loadServerEnv } from '@/env';

const PUBLIC_REVALIDATE_SECONDS = 15 * 60;
const PUBLIC_REQUEST_TIMEOUT_MS = 5_000;

export type PublicRead<T> = { status: 'ready'; data: T } | { status: 'unavailable'; data: T };
export type PublicDetailRead<T> =
  | { status: 'ready'; data: T }
  | { status: 'not-found'; data: null }
  | { status: 'unavailable'; data: null };

export type PublicHomeData = {
  clinic: PublicRead<PublicClinicProfile>;
  services: PublicRead<PublicServiceSummary[]>;
  team: PublicRead<PublicTherapistProfile[]>;
};

const EMPTY_CLINIC_PROFILE: PublicClinicProfile = {
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

/**
 * The public read lane is intentionally separate from the authenticated API
 * client. It sends the internal key but never accepts or forwards a session,
 * browser header, arbitrary path, or arbitrary schema. Every response is
 * parsed against A1's purpose-built public projection before a page sees it.
 */
async function readPublic<T>(
  path:
    | '/public/services'
    | `/public/services/${string}`
    | '/public/team'
    | `/public/team/${string}`
    | '/public/clinic-profile'
    | '/public/articles'
    | `/public/articles/${string}`
    | '/public/testimonials'
    | '/public/sitemap',
  schema: { parse: (value: unknown) => T },
  tag: (typeof PUBLIC_CACHE_TAGS)[keyof typeof PUBLIC_CACHE_TAGS],
  fallback: T,
): Promise<PublicRead<T>> {
  const { API_BASE_URL, INTERNAL_API_KEY } = loadServerEnv();

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'x-internal-key': INTERNAL_API_KEY,
        'x-request-id': randomUUID(),
      },
      cache: 'force-cache',
      next: { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: [tag] },
      signal: AbortSignal.timeout(PUBLIC_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) return { status: 'unavailable', data: fallback };

    const payload: unknown = await response.json();
    return { status: 'ready', data: schema.parse(payload) };
  } catch {
    // A transport failure or widened/malformed success is the same public
    // state: the page stays useful and says no clinic fact it did not receive.
    return { status: 'unavailable', data: fallback };
  }
}

async function readPublicDetail<T>(
  path: `/public/services/${string}` | `/public/team/${string}` | `/public/articles/${string}`,
  schema: { parse: (value: unknown) => T },
  tag: string,
): Promise<PublicDetailRead<T>> {
  const { API_BASE_URL, INTERNAL_API_KEY } = loadServerEnv();

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'x-internal-key': INTERNAL_API_KEY,
        'x-request-id': randomUUID(),
      },
      cache: 'force-cache',
      next: { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: [tag] },
      signal: AbortSignal.timeout(PUBLIC_REQUEST_TIMEOUT_MS),
    });

    if (response.status === 404) return { status: 'not-found', data: null };
    if (!response.ok) return { status: 'unavailable', data: null };

    const payload: unknown = await response.json();
    return { status: 'ready', data: schema.parse(payload) };
  } catch {
    return { status: 'unavailable', data: null };
  }
}

export async function getPublicClinicProfile(): Promise<PublicRead<PublicClinicProfile>> {
  const result = await readPublic(
    '/public/clinic-profile',
    publicClinicProfileResponseSchema,
    PUBLIC_CACHE_TAGS.clinicProfile,
    { clinic: EMPTY_CLINIC_PROFILE },
  );

  return { status: result.status, data: result.data.clinic };
}

export async function getPublicHomeData(): Promise<PublicHomeData> {
  const [clinic, services, team] = await Promise.all([
    getPublicClinicProfile(),
    readPublic('/public/services', publicServiceListResponseSchema, PUBLIC_CACHE_TAGS.services, {
      services: [],
    }),
    readPublic('/public/team', publicTeamResponseSchema, PUBLIC_CACHE_TAGS.team, {
      therapists: [],
    }),
  ]);

  return {
    clinic,
    services: { status: services.status, data: services.data.services },
    team: { status: team.status, data: team.data.therapists },
  };
}

export async function getPublicServices(): Promise<PublicRead<PublicServiceSummary[]>> {
  const result = await readPublic(
    '/public/services',
    publicServiceListResponseSchema,
    PUBLIC_CACHE_TAGS.services,
    { services: [] },
  );
  return { status: result.status, data: result.data.services };
}

export async function getPublicService(
  slug: string,
): Promise<PublicDetailRead<PublicServiceDetail>> {
  const result = await readPublicDetail(
    `/public/services/${encodeURIComponent(slug)}`,
    publicServiceDetailResponseSchema,
    `${PUBLIC_SERVICE_CACHE_TAG_PREFIX}${slug}`,
  );
  return result.status === 'ready'
    ? { status: 'ready', data: result.data.service }
    : { status: result.status, data: null };
}

export async function getPublicTeam(): Promise<PublicRead<PublicTherapistProfile[]>> {
  const result = await readPublic(
    '/public/team',
    publicTeamResponseSchema,
    PUBLIC_CACHE_TAGS.team,
    {
      therapists: [],
    },
  );
  return { status: result.status, data: result.data.therapists };
}

export async function getPublicTherapist(
  slug: string,
): Promise<PublicDetailRead<PublicTherapistProfile>> {
  const result = await readPublicDetail(
    `/public/team/${encodeURIComponent(slug)}`,
    publicTherapistProfileResponseSchema,
    `${PUBLIC_THERAPIST_CACHE_TAG_PREFIX}${slug}`,
  );
  return result.status === 'ready'
    ? { status: 'ready', data: result.data.therapist }
    : { status: result.status, data: null };
}

export async function getPublicArticles(): Promise<PublicRead<PublicArticleSummary[]>> {
  const result = await readPublic(
    '/public/articles',
    publicArticleListResponseSchema,
    PUBLIC_CACHE_TAGS.articles,
    { articles: [] },
  );
  return { status: result.status, data: result.data.articles };
}

export async function getPublicArticle(
  slug: string,
): Promise<PublicDetailRead<PublicArticleDetail>> {
  const result = await readPublicDetail(
    `/public/articles/${encodeURIComponent(slug)}`,
    publicArticleDetailResponseSchema,
    `${PUBLIC_ARTICLE_CACHE_TAG_PREFIX}${slug}`,
  );
  return result.status === 'ready'
    ? { status: 'ready', data: result.data.article }
    : { status: result.status, data: null };
}

export async function getPublicTestimonials(): Promise<PublicRead<PublicTestimonial[]>> {
  const result = await readPublic(
    '/public/testimonials',
    publicTestimonialListResponseSchema,
    PUBLIC_CACHE_TAGS.testimonials,
    { testimonials: [] },
  );
  return { status: result.status, data: result.data.testimonials };
}

export async function getPublicSitemap(): Promise<PublicRead<PublicSitemapEntry[]>> {
  const result = await readPublic(
    '/public/sitemap',
    publicSitemapResponseSchema,
    PUBLIC_CACHE_TAGS.sitemap,
    { entries: [] },
  );
  return { status: result.status, data: result.data.entries };
}
