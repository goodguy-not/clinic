import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  PublicArticleDetail,
  PublicImage,
  PublicArticleSummary,
  PublicClinicProfile,
  PublicServiceDetail,
  PublicServiceSummary,
  PublicSitemapEntry,
  PublicTestimonial,
  PublicTherapistProfile,
} from '@clinic/contracts';
import { AppError } from '../common/app-error';
import { PublicMediaService } from '../media/public-media.service';
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
 *
 * MILESTONE 9, CHECKPOINT A2 ADDS FOUR READS AND CHANGES NONE OF THE FIVE
 * ABOVE. Articles and testimonials arrive with their own tables and their own
 * published-only predicates, written out in the same style and for the same
 * reason; the sitemap is derived from the same predicates as the pages it
 * lists, in one statement, so it cannot advertise a URL that answers 404.
 *
 * MILESTONE 9.5, CHECKPOINT A5 ADDS AN IMAGE FIELD TO FOUR OF THESE
 * PROJECTIONS AND CHANGES NO PREDICATE ABOVE. The photographs come from
 * `PublicMediaService`, which applies its own single published-only predicate;
 * this file does not query the media tables and does not restate that rule,
 * which is the one place the "repeat the predicate" discipline is deliberately
 * NOT followed. The reason is that the media rule is not a variation per page —
 * it is one four-condition rule about one subsystem, it is stated once in
 * `media-visibility.ts`, and a copy of it here would be a second answer to
 * "may a stranger see this photograph?" that could drift from the one the
 * serving route actually applies.
 *
 * THE INTERNAL ID IS NOW SELECTED IN FOUR STATEMENTS AND PROJECTED IN NONE.
 * It is the join key the media lookup needs and it is dropped by the mappers at
 * the bottom of this file; the public contracts remain `strictObject`, so an id
 * reaching a response would fail a test rather than reach a browser.
 *
 * `publishedAt` ON AN ARTICLE IS THE ONE TIMESTAMP THIS SURFACE PROJECTS, and
 * it is a deliberate exception rather than a lapse: "when was this service
 * entered" is internal history a visitor is not owed, while the date an article
 * was published is editorial content a reader judges it by. It is the FIRST
 * publication, never a later edit.
 */

type PublicServiceRow = {
  public_slug: string;
  name: string;
  public_description: string | null;
};

type PublicServiceDetailRow = PublicServiceRow & { durations: number[] };

type PublicTherapistRow = {
  /** The join key for the media lookup. Never projected — see the class note. */
  internal_id: string;
  public_slug: string;
  public_display_name: string;
  public_title: string | null;
  public_bio: string | null;
  public_photo_path: string | null;
};

type PublicArticleRow = {
  /** The join key for the media lookup. Never projected — see the class note. */
  internal_id: string;
  public_slug: string;
  published_title: string;
  published_summary: string | null;
  public_first_published_at: Date;
};

type PublicArticleDetailRow = PublicArticleRow & { published_body: string };

type PublicTestimonialRow = {
  /** The join key for the media lookup. Never projected — see the class note. */
  internal_id: string;
  author_label: string | null;
  body: string;
};

type SitemapRow = {
  kind: 'service' | 'therapist' | 'article';
  public_slug: string;
  public_revised_at: Date | null;
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
  spacePhotos: [],
};

@Injectable()
export class PublicSiteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: PublicMediaService,
  ) {}

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
      SELECT t.id AS internal_id, t.public_slug, t.public_display_name, t.public_title,
             t.public_bio, t.public_photo_path
      FROM therapist t
      WHERE t.is_public IS TRUE
        AND t.status = 'ACTIVE'::catalog_status
        AND t.public_slug IS NOT NULL
        AND t.public_display_name IS NOT NULL
      ORDER BY t.public_display_order ASC, t.public_display_name ASC, t.id ASC
    `;

    const photos = await this.media.imagesForOwners(
      'THERAPIST_PROFILE',
      rows.map((row) => row.internal_id),
    );

    return rows.map((row) => toPublicTherapistProfile(row, firstImage(photos, row.internal_id)));
  }

  /**
   * One published profile. A therapist who has not opted in is
   * `THERAPIST_NOT_FOUND`, for the reason a private service is
   * `SERVICE_NOT_FOUND`.
   */
  async getTherapist(slug: string): Promise<PublicTherapistProfile> {
    const rows = await this.prisma.$queryRaw<PublicTherapistRow[]>`
      SELECT t.id AS internal_id, t.public_slug, t.public_display_name, t.public_title,
             t.public_bio, t.public_photo_path
      FROM therapist t
      WHERE t.public_slug = ${slug}
        AND t.is_public IS TRUE
        AND t.status = 'ACTIVE'::catalog_status
        AND t.public_display_name IS NOT NULL
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('THERAPIST_NOT_FOUND');

    const photos = await this.media.imagesForOwners('THERAPIST_PROFILE', [row.internal_id]);

    return toPublicTherapistProfile(row, firstImage(photos, row.internal_id));
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
  async getClinicProfile(tx?: Prisma.TransactionClient): Promise<PublicClinicProfile> {
    // The optional transaction client is what lets the manager write path read
    // the profile it is about to replace, and read it again afterwards, inside
    // its own transaction — one projection, one set of column names, and no
    // second query that could drift from this one.
    const client = tx ?? this.prisma;
    const rows = await client.$queryRaw<ClinicProfileRow[]>`
      SELECT
        display_name, tagline, about, address_line, city_label,
        phone_primary, phone_secondary, email, working_hours_note,
        map_latitude, map_longitude, instagram_url, telegram_url
      FROM clinic_public_profile
      WHERE singleton_key = 1
    `;

    // The gallery is read through `PublicMediaService`, on the same client, so
    // the manager write path that calls this inside its own transaction sees
    // its own uncommitted change rather than a gallery from before it.
    const spacePhotos = await this.media.clinicSpaceImages(tx);

    const row = rows[0];
    if (row === undefined) return { ...EMPTY_CLINIC_PROFILE, spacePhotos };

    return {
      spacePhotos,
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

  /**
   * The published articles, newest first.
   *
   * IT READS THE PUBLISHED COLUMNS AND NEVER THE DRAFT ONES, and that is the
   * publication authority rather than a naming preference. An article holds its
   * copy twice — `title`/`summary`/`body` is the working draft that anybody
   * holding `article.draft` may rewrite, and `published_*` is what a manager
   * last approved. Selecting the draft here is exactly the defect this
   * projection exists to prevent: a receptionist's unreviewed prose on a live
   * page, with nobody having decided it should be there.
   *
   * TWO CONDITIONS, AND THE SECOND IS NOT REDUNDANT. `is_public` is the
   * recorded decision to publish; `public_first_published_at IS NOT NULL` is
   * the database's own record that the decision took effect, and it is what the
   * `publishedAt` field is built from. The trigger sets it in the same
   * statement that sets the flag, so the two cannot disagree — and demanding
   * both means no query here can produce a row with a null date and no code
   * below has to invent one.
   *
   * A DRAFT IS UNREACHABLE THROUGH THIS READ AND THROUGH `getArticle`, and
   * those are the only two statements in the application that select from
   * `public_article` on behalf of a visitor.
   */
  async listArticles(): Promise<PublicArticleSummary[]> {
    const rows = await this.prisma.$queryRaw<PublicArticleRow[]>`
      SELECT a.id AS internal_id, a.public_slug, a.published_title, a.published_summary,
             a.public_first_published_at
      FROM public_article a
      WHERE a.is_public IS TRUE
        AND a.public_first_published_at IS NOT NULL
      ORDER BY a.public_first_published_at DESC, a.id DESC
    `;

    const images = await this.media.imagesForOwners(
      'PUBLIC_ARTICLE',
      rows.map((row) => row.internal_id),
    );

    return rows.map((row) => toPublicArticleSummary(row, images.get(row.internal_id) ?? []));
  }

  /**
   * One published article, as the manager last approved it.
   *
   * A draft is `ARTICLE_NOT_FOUND` — the SAME answer a slug nobody has used
   * gets, for the reason a private service is `SERVICE_NOT_FOUND`: two
   * different answers would let anybody enumerate what the clinic is still
   * writing. An article with a PREPARED CHANGE is not a draft: it answers, with
   * the words that were approved.
   */
  async getArticle(slug: string): Promise<PublicArticleDetail> {
    const rows = await this.prisma.$queryRaw<PublicArticleDetailRow[]>`
      SELECT
        a.id AS internal_id,
        a.public_slug,
        a.published_title,
        a.published_summary,
        a.published_body,
        a.public_first_published_at
      FROM public_article a
      WHERE a.public_slug = ${slug}
        AND a.is_public IS TRUE
        AND a.public_first_published_at IS NOT NULL
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('ARTICLE_NOT_FOUND');

    const images = await this.media.imagesForOwners('PUBLIC_ARTICLE', [row.internal_id]);

    return {
      ...toPublicArticleSummary(row, images.get(row.internal_id) ?? []),
      body: row.published_body,
    };
  }

  /**
   * The approved, published testimonials.
   *
   * THREE CONDITIONS, AND THE APPROVAL ONE IS STATED HERE EVEN THOUGH THE
   * DATABASE ALREADY GUARANTEES IT. `public_testimonial_approval_chk` refuses
   * `is_public` on anything that is not `APPROVED`, so `status = 'APPROVED'`
   * below can never change a result — which is exactly why it is written out.
   * The cost of the constraint and this query disagreeing is publishing a
   * family's words that no manager reviewed, and a reader of this file should
   * be able to see the privacy rule in the predicate rather than have to go and
   * find it in a migration.
   *
   * No slug, no id, no date, no status: the projection is two columns because
   * the public contract is two fields.
   */
  async listTestimonials(): Promise<PublicTestimonial[]> {
    const rows = await this.prisma.$queryRaw<PublicTestimonialRow[]>`
      SELECT t.id AS internal_id, t.author_label, t.body
      FROM public_testimonial t
      WHERE t.is_public IS TRUE
        AND t.status = 'APPROVED'::testimonial_status
        AND t.approved_at IS NOT NULL
      ORDER BY t.public_first_published_at DESC, t.id DESC
    `;

    const images = await this.media.imagesForOwners(
      'PUBLIC_TESTIMONIAL',
      rows.map((row) => row.internal_id),
    );

    return rows.map((row) => ({
      authorLabel: row.author_label,
      body: row.body,
      image: firstImage(images, row.internal_id),
    }));
  }

  /**
   * Every data-driven public URL that currently exists, and its last-modified.
   *
   * ONE STATEMENT, THREE BRANCHES, AND EACH BRANCH REPEATS ITS PAGE'S OWN
   * PREDICATE WORD FOR WORD. That repetition is the design, exactly as it is
   * for the five reads above: a helper that assembled the conditions would be
   * one place to forget one, and the failure would be a sitemap that lists a
   * page answering 404 or omits one that answers. Written out, the sitemap is
   * verifiably the union of the pages.
   *
   * NO PATH AND NO HOST. `kind` plus `slug` is what this tier knows; the route
   * structure belongs to the web tier, which owns its router.
   *
   * A TESTIMONIAL IS ABSENT BECAUSE IT IS NOT A PAGE, and the static pages —
   * home, about, contact, the privacy notice — are absent because they exist
   * whether or not anybody publishes anything.
   */
  async listSitemapEntries(): Promise<PublicSitemapEntry[]> {
    const rows = await this.prisma.$queryRaw<SitemapRow[]>`
      SELECT 'service' AS kind, s.public_slug, s.public_revised_at, s.name AS sort_key
      FROM service s
      WHERE s.is_public IS TRUE
        AND s.status = 'ACTIVE'::catalog_status
        AND s.public_slug IS NOT NULL

      UNION ALL

      SELECT 'therapist' AS kind, t.public_slug, t.public_revised_at, t.public_display_name
      FROM therapist t
      WHERE t.is_public IS TRUE
        AND t.status = 'ACTIVE'::catalog_status
        AND t.public_slug IS NOT NULL
        AND t.public_display_name IS NOT NULL

      UNION ALL

      SELECT 'article' AS kind, a.public_slug, a.public_revised_at, a.published_title
      FROM public_article a
      WHERE a.is_public IS TRUE
        AND a.public_first_published_at IS NOT NULL

      ORDER BY kind ASC, sort_key ASC
    `;

    return rows.map((row) => ({
      kind: row.kind,
      slug: row.public_slug,
      lastModified: row.public_revised_at === null ? null : row.public_revised_at.toISOString(),
    }));
  }
}

function toPublicArticleSummary(
  row: PublicArticleRow,
  images: PublicImage[],
): PublicArticleSummary {
  return {
    images,
    slug: row.public_slug,
    title: row.published_title,
    summary: row.published_summary,
    // Non-null by the predicate every query above applies, restated for the
    // type system rather than assumed: a nullable date on a public contract
    // would be a field the web tier had to defend against.
    publishedAt: row.public_first_published_at.toISOString(),
  };
}

function toPublicServiceSummary(row: PublicServiceRow): PublicServiceSummary {
  return { slug: row.public_slug, name: row.name, description: row.public_description };
}

function toPublicTherapistProfile(
  row: PublicTherapistRow,
  photo: PublicImage | null,
): PublicTherapistProfile {
  return {
    slug: row.public_slug,
    displayName: row.public_display_name,
    title: row.public_title,
    bio: row.public_bio,
    photoPath: row.public_photo_path,
    photo,
  };
}

/**
 * The one photograph on a single-image owner.
 *
 * A therapist has one portrait and a testimonial has one photographed note; the
 * attachment table permits more, so this takes the FIRST in the clinic's own
 * order rather than refusing to render anything. Silently showing one of two is
 * better than a blank page, and the library shows a manager every attachment
 * there is.
 */
function firstImage(images: Map<string, PublicImage[]>, ownerId: string): PublicImage | null {
  return images.get(ownerId)?.[0] ?? null;
}
