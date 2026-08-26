import 'server-only';
import { randomUUID } from 'node:crypto';
import {
  PUBLIC_CACHE_TAGS,
  publicClinicProfileResponseSchema,
  publicServiceListResponseSchema,
  publicTeamResponseSchema,
  type PublicClinicProfile,
  type PublicServiceSummary,
  type PublicTherapistProfile,
} from '@clinic/contracts';
import { loadServerEnv } from '@/env';

const PUBLIC_REVALIDATE_SECONDS = 15 * 60;
const PUBLIC_REQUEST_TIMEOUT_MS = 5_000;

export type PublicRead<T> = { status: 'ready'; data: T } | { status: 'unavailable'; data: T };

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
  path: '/public/services' | '/public/team' | '/public/clinic-profile',
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
