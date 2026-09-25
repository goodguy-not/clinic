import 'server-only';
import { randomUUID } from 'node:crypto';
import { cache } from 'react';
import {
  PUBLIC_CACHE_TAGS,
  PUBLIC_ARTICLE_CACHE_TAG_PREFIX,
  PUBLIC_SERVICE_CACHE_TAG_PREFIX,
  PUBLIC_THERAPIST_CACHE_TAG_PREFIX,
  publicArticleDetailResponseSchema,
  publicArticleListResponseSchema,
  publicClinicContentResponseSchema,
  publicClinicProfileResponseSchema,
  publicSpaceListResponseSchema,
  publicServiceDetailResponseSchema,
  publicServiceListResponseSchema,
  publicSitemapResponseSchema,
  publicTeamResponseSchema,
  publicTestimonialListResponseSchema,
  publicTherapistProfileResponseSchema,
  publicRequestSubmissionResponseSchema,
  errorEnvelopeSchema,
  type PublicArticleDetail,
  type PublicArticleSummary,
  type PublicClinicContentResponse,
  type PublicClinicProfile,
  type PublicServiceDetail,
  type PublicServiceSummary,
  type PublicSpace,
  type PublicSitemapEntry,
  type PublicTestimonial,
  type PublicTherapistProfile,
  type PublicRequestSubmission,
} from '@clinic/contracts';
import { loadServerEnv } from '@/env';

const PUBLIC_REVALIDATE_SECONDS = 15 * 60;
const PUBLIC_REQUEST_TIMEOUT_MS = 5_000;

/**
 * The current API projection still carries mediaId for staff-side bookkeeping.
 * Strip it at the Web public boundary so React cannot serialize it into visitor
 * HTML while the contract is narrowed independently by the API lane.
 */
export function stripPublicInternalIds<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripPublicInternalIds) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, child]) =>
        key === 'mediaId' ? [] : [[key, stripPublicInternalIds(child)]],
      ),
    ) as T;
  }
  return value;
}

export type PublicRequestWriteResult =
  { ok: true } | { ok: false; reason: 'invalid' | 'service-context' | 'throttled' | 'unavailable' };

type PublicVisitorContext = {
  clientIp: string | null;
};

export type PublicRead<T> = { status: 'ready'; data: T } | { status: 'unavailable'; data: T };
export type PublicDetailRead<T> =
  | { status: 'ready'; data: T }
  | { status: 'not-found'; data: null }
  | { status: 'unavailable'; data: null };

export type PublicHomeData = {
  clinic: PublicRead<PublicClinicProfile>;
  content: PublicRead<PublicClinicContentResponse>;
  services: PublicRead<PublicServiceSummary[]>;
  team: PublicRead<PublicTherapistProfile[]>;
  spaces: PublicRead<PublicSpace[]>;
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
    | '/public/clinic-content'
    | '/public/spaces'
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
      },
      cache: 'force-cache',
      next: { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: [tag] },
      signal: AbortSignal.timeout(PUBLIC_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) return { status: 'unavailable', data: fallback };

    const payload: unknown = await response.json();
    return { status: 'ready', data: stripPublicInternalIds(schema.parse(payload)) };
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
      },
      cache: 'force-cache',
      next: { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: [tag] },
      signal: AbortSignal.timeout(PUBLIC_REQUEST_TIMEOUT_MS),
    });

    if (response.status === 404) return { status: 'not-found', data: null };
    if (!response.ok) return { status: 'unavailable', data: null };

    const payload: unknown = await response.json();
    return { status: 'ready', data: stripPublicInternalIds(schema.parse(payload)) };
  } catch {
    return { status: 'unavailable', data: null };
  }
}

export const getPublicClinicProfile = cache(async function getPublicClinicProfile(): Promise<
  PublicRead<PublicClinicProfile>
> {
  const result = await readPublic(
    '/public/clinic-profile',
    publicClinicProfileResponseSchema,
    PUBLIC_CACHE_TAGS.clinicProfile,
    { clinic: EMPTY_CLINIC_PROFILE },
  );

  return { status: result.status, data: result.data.clinic };
});

export const getPublicClinicContent = cache(async function getPublicClinicContent(): Promise<
  PublicRead<PublicClinicContentResponse>
> {
  return readPublic(
    '/public/clinic-content',
    publicClinicContentResponseSchema,
    PUBLIC_CACHE_TAGS.clinicProfile,
    { openGraphImage: null, entries: [] },
  );
});

export const getPublicSpaces = cache(async function getPublicSpaces(): Promise<
  PublicRead<PublicSpace[]>
> {
  const result = await readPublic(
    '/public/spaces',
    publicSpaceListResponseSchema,
    PUBLIC_CACHE_TAGS.spaces,
    { spaces: [] },
  );
  return { status: result.status, data: result.data.spaces };
});

export const getPublicMetadataContext = cache(async function getPublicMetadataContext() {
  const [clinic, content] = await Promise.all([getPublicClinicProfile(), getPublicClinicContent()]);
  return {
    clinicName: clinic.data.displayName,
    openGraphImage: content.data.openGraphImage,
  };
});

export async function getPublicHomeData(): Promise<PublicHomeData> {
  const [clinic, content, services, team, spaces] = await Promise.all([
    getPublicClinicProfile(),
    getPublicClinicContent(),
    readPublic('/public/services', publicServiceListResponseSchema, PUBLIC_CACHE_TAGS.services, {
      services: [],
    }),
    readPublic('/public/team', publicTeamResponseSchema, PUBLIC_CACHE_TAGS.team, {
      therapists: [],
    }),
    getPublicSpaces(),
  ]);

  return {
    clinic,
    content,
    services: { status: services.status, data: services.data.services },
    team: { status: team.status, data: team.data.therapists },
    spaces,
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

export const getPublicService = cache(async function getPublicService(
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
});

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

export const getPublicTherapist = cache(async function getPublicTherapist(
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
});

export async function getPublicArticles(): Promise<PublicRead<PublicArticleSummary[]>> {
  const result = await readPublic(
    '/public/articles',
    publicArticleListResponseSchema,
    PUBLIC_CACHE_TAGS.articles,
    { articles: [] },
  );
  return { status: result.status, data: result.data.articles };
}

export const getPublicArticle = cache(async function getPublicArticle(
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
});

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

/**
 * The sole public write crosses the same server-only boundary as every public
 * read. The browser never learns the NestJS address or internal key, and every
 * successful response is parsed against A3's deliberately neutral shape.
 */
export async function submitPublicRequest(
  body: PublicRequestSubmission,
  context: PublicVisitorContext,
): Promise<PublicRequestWriteResult> {
  const { API_BASE_URL, INTERNAL_API_KEY } = loadServerEnv();
  const headers = new Headers({
    accept: 'application/json',
    'content-type': 'application/json',
    'x-internal-key': INTERNAL_API_KEY,
    'x-request-id': randomUUID(),
  });
  if (context.clientIp !== null && context.clientIp !== '') {
    headers.set('x-client-ip', context.clientIp);
  }

  try {
    const response = await fetch(`${API_BASE_URL}/public/requests`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(PUBLIC_REQUEST_TIMEOUT_MS),
    });

    if (response.ok) {
      const parsed = publicRequestSubmissionResponseSchema.safeParse(await response.json());
      return parsed.success ? { ok: true } : { ok: false, reason: 'unavailable' };
    }

    const envelope = errorEnvelopeSchema.safeParse(await response.json().catch(() => null));
    const code = envelope.success ? envelope.data.error.code : null;
    if (response.status === 429 && code === 'PUBLIC_REQUEST_THROTTLED') {
      return { ok: false, reason: 'throttled' };
    }
    if (response.status === 404 && code === 'SERVICE_NOT_FOUND') {
      return { ok: false, reason: 'service-context' };
    }
    if (response.status === 400 && code === 'VALIDATION_FAILED') {
      return { ok: false, reason: 'invalid' };
    }
    return { ok: false, reason: 'unavailable' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
