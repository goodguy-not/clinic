import { Injectable } from '@nestjs/common';
import type {
  PublicClinicProfile,
  PublicServiceDetail,
  PublicServiceSummary,
  PublicTherapistProfile,
} from '@clinic/contracts';
import { AppError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Every read the public website makes, and nothing else.
 *
 * Milestone 9, checkpoint A1.
 *
 * THE PROJECTIONS ARE WRITTEN OUT COLUMN BY COLUMN, AND THAT IS THE PRIVACY
 * MECHANISM. Nothing in this file selects a row and then removes fields from
 * it: each statement names exactly the columns the public contract carries, so
 * a column added to `service` or `therapist` tomorrow — an internal note, a
 * personnel identifier, a settlement percentage — cannot arrive on the website
 * because somebody widened a shared query. `SELECT *` and any reuse of
 * `ServicesService` or `TherapistsService` would both have that failure mode,
 * which is why this module owns its own reads even though the tables are not
 * its own.
 *
 * THE VISIBILITY PREDICATE IS REPEATED IN EVERY STATEMENT RATHER THAN FACTORED
 * OUT OF THEM, and it is the same three or four conditions each time. A helper
 * that assembled it would be one place to forget a condition and four places
 * that silently inherited the omission; written out, each read states in full
 * what it considers publishable, and the tests that try to reach a private row
 * through each route in turn read as the mirror image of these WHERE clauses.
 *
 * WHAT A PUBLIC READ MAY NEVER RETURN: an internal identifier, a catalog
 * status, a deactivation timestamp, the visibility flag itself, a creator, a
 * timestamp, a price, an availability window, or any family, child,
 * appointment, charge, payment, settlement or audit fact. None of those columns
 * is named anywhere below.
 */

type PublicServiceRow = {
  public_slug: string;
  name: string;
  public_description: string | null;
};

type PublicServiceDetailRow = PublicServiceRow & { durations: number[] };

type PublicTherapistRow = {
  public_slug: string;
  public_display_name: string;
  public_title: string | null;
  public_bio: string | null;
  public_photo_path: string | null;
};

type ClinicProfileRow = {
  display_name: string | null;
  tagline: string | null;
  about: string | null;
  address_line: string | null;
  city_label: string | null;
  phone_primary: string | null;
  phone_secondary: string | null;
  email: string | null;
  working_hours_note: string | null;
  map_latitude: number | null;
  map_longitude: number | null;
  instagram_url: string | null;
  telegram_url: string | null;
};

/** The profile as it reads before the owner has supplied anything. */
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

@Injectable()
export class PublicSiteService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The services the clinic publishes, in name order.
   *
   * THREE CONDITIONS, AND ALL THREE ARE REQUIRED. `is_public` is the intent to
   * publish, `status = 'ACTIVE'` is the service still being offered — a
   * retired service is not advertised, whatever flag it still carries — and a
   * non-null slug is the address without which no page could link to it
   * anyway.
   */
  async listServices(): Promise<PublicServiceSummary[]> {
    const rows = await this.prisma.$queryRaw<PublicServiceRow[]>`
      SELECT s.public_slug, s.name, s.public_description
      FROM service s
      WHERE s.is_public IS TRUE
        AND s.status = 'ACTIVE'::catalog_status
        AND s.public_slug IS NOT NULL
      ORDER BY s.name ASC
    `;

    return rows.map(toPublicServiceSummary);
  }

  /**
   * One published service, addressed by its slug.
   *
   * A private, retired or unpublished service is `SERVICE_NOT_FOUND` — the SAME
   * answer a slug nobody has ever used gets. A separate "exists but is not
   * public" response would be a side channel: anybody could enumerate the
   * clinic's internal catalogue by watching which spellings answered
   * differently.
   */
  async getService(slug: string): Promise<PublicServiceDetail> {
    const rows = await this.prisma.$queryRaw<PublicServiceDetailRow[]>`
      SELECT
        s.public_slug,
        s.name,
        s.public_description,
        COALESCE(
          (
            SELECT array_agg(d.duration_minutes ORDER BY d.duration_minutes)
            FROM service_duration d
            WHERE d.service_id = s.id
          ),
          ARRAY[]::int[]
        ) AS durations
      FROM service s
      WHERE s.public_slug = ${slug}
        AND s.is_public IS TRUE
        AND s.status = 'ACTIVE'::catalog_status
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('SERVICE_NOT_FOUND');

    return { ...toPublicServiceSummary(row), sessionDurationsMinutes: row.durations };
  }

  /**
   * The team, in the clinic's own public ordering.
   *
   * FOUR CONDITIONS, AND THE LAST TWO ARE THE OPT-IN. `is_public` is the
   * recorded decision to publish this person; the slug and the approved display
   * name are the content that decision was taken about. `therapist_public_
   * profile_chk` already refuses a row that has the first without the other
   * two, so the predicate is belt and braces — deliberately, because the cost
   * of the database and the query disagreeing here is publishing somebody who
   * did not agree to be published.
   *
   * `status = 'ACTIVE'` is separate from all of that: a colleague who has left
   * stops appearing on the website without anybody having to remember to clear
   * their public flag.
   *
   * The ordering is total — the clinic's chosen order, then the display name,
   * then the id — so the team page does not quietly reshuffle between requests.
   */
  async listTeam(): Promise<PublicTherapistProfile[]> {
    const rows = await this.prisma.$queryRaw<PublicTherapistRow[]>`
      SELECT t.public_slug, t.public_display_name, t.public_title, t.public_bio, t.public_photo_path
      FROM therapist t
      WHERE t.is_public IS TRUE
        AND t.status = 'ACTIVE'::catalog_status
        AND t.public_slug IS NOT NULL
        AND t.public_display_name IS NOT NULL
      ORDER BY t.public_display_order ASC, t.public_display_name ASC, t.id ASC
    `;

    return rows.map(toPublicTherapistProfile);
  }

  /**
   * One published profile. A therapist who has not opted in is
   * `THERAPIST_NOT_FOUND`, for the reason a private service is
   * `SERVICE_NOT_FOUND`.
   */
  async getTherapist(slug: string): Promise<PublicTherapistProfile> {
    const rows = await this.prisma.$queryRaw<PublicTherapistRow[]>`
      SELECT t.public_slug, t.public_display_name, t.public_title, t.public_bio, t.public_photo_path
      FROM therapist t
      WHERE t.public_slug = ${slug}
        AND t.is_public IS TRUE
        AND t.status = 'ACTIVE'::catalog_status
        AND t.public_display_name IS NOT NULL
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('THERAPIST_NOT_FOUND');

    return toPublicTherapistProfile(row);
  }

  /**
   * The clinic's own public facts. ALWAYS SUCCEEDS.
   *
   * The row is created by the migration and cannot be deleted, so the fallback
   * below is unreachable in a migrated database. It exists because the
   * alternative — a 404 or a 500 — would take down the contact page of a live
   * website over a configuration row, and a profile whose fields are all null
   * is exactly what an unconfigured clinic HAS. Nothing is invented here: the
   * empty profile states nothing.
   */
  async getClinicProfile(): Promise<PublicClinicProfile> {
    const rows = await this.prisma.$queryRaw<ClinicProfileRow[]>`
      SELECT
        display_name, tagline, about, address_line, city_label,
        phone_primary, phone_secondary, email, working_hours_note,
        map_latitude, map_longitude, instagram_url, telegram_url
      FROM clinic_public_profile
      WHERE singleton_key = 1
    `;

    const row = rows[0];
    if (row === undefined) return EMPTY_CLINIC_PROFILE;

    return {
      displayName: row.display_name,
      tagline: row.tagline,
      about: row.about,
      addressLine: row.address_line,
      cityLabel: row.city_label,
      phonePrimary: row.phone_primary,
      phoneSecondary: row.phone_secondary,
      email: row.email,
      workingHoursNote: row.working_hours_note,
      mapLatitude: row.map_latitude,
      mapLongitude: row.map_longitude,
      instagramUrl: row.instagram_url,
      telegramUrl: row.telegram_url,
    };
  }
}

function toPublicServiceSummary(row: PublicServiceRow): PublicServiceSummary {
  return { slug: row.public_slug, name: row.name, description: row.public_description };
}

function toPublicTherapistProfile(row: PublicTherapistRow): PublicTherapistProfile {
  return {
    slug: row.public_slug,
    displayName: row.public_display_name,
    title: row.public_title,
    bio: row.public_bio,
    photoPath: row.public_photo_path,
  };
}
