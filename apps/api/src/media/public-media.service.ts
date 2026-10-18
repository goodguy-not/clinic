import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PUBLIC_MEDIA_PATH_PREFIX,
  isOwnerlessMediaAttachment,
  type MediaAttachmentOwner,
  type MediaFraming,
  type MediaRenditionFormat,
  type PublicImage,
} from '@clinic/contracts';
import { AppError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { LIVE_ATTACHMENT_PREDICATE } from './media-visibility';
import { MediaStorageService } from './media-storage.service';

/**
 * Everything an anonymous visitor can reach in the media subsystem, and nothing
 * else.
 *
 * Milestone 9.5, checkpoint A5. This file is the mirror of
 * `PublicSiteService`: every method on it is reachable without a session, so
 * every method on it must be INCAPABLE of returning something unpublished
 * rather than merely careful not to. There is exactly one predicate,
 * `LIVE_ATTACHMENT_PREDICATE`, it is in the `WHERE` clause of every statement
 * here, and the refusal matrix in `media-public-access.int-spec.ts` attacks
 * each of its four conditions in turn.
 *
 * THE MASTER IS NOT REACHABLE FROM ANY METHOD HERE, and not because a branch
 * excludes it. `findServableRendition` selects from `media_rendition`; the
 * master is a column on `media_asset` and has no row in that table. There is no
 * identifier a caller could send that would name it.
 *
 * ONE REFUSAL, WHATEVER THE REASON. Unknown id, archived asset, unattached
 * asset, drafted attachment, unpublished attachment, unpublished owner,
 * detached attachment, missing file: all `MEDIA_NOT_FOUND`. Distinguishing them
 * would let a stranger walk the identifier space and learn which photographs
 * the clinic is holding but has not published — a disclosure about unpublished
 * content, made to exactly the audience the publication rule exists to keep it
 * from. It is `DRAFT_NOT_FOUND`'s reasoning, applied to bytes.
 */
@Injectable()
export class PublicMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MediaStorageService,
  ) {}

  /**
   * The bytes behind one rendition id, if and only if a stranger may have them.
   *
   * THE PREDICATE IS EVALUATED HERE, ON THIS REQUEST, AGAINST LIVE ROWS. There
   * is no cache, no memoisation and no warmed lookup table anywhere in this
   * class, which is what makes the frozen rule "unpublish/archive stops serving
   * at Vala's origin immediately" true without qualification.
   *
   * THE FILE IS READ ONLY AFTER THE ROW SAYS YES. Two round trips instead of
   * one, deliberately: an implementation that read the file first and checked
   * afterwards would have the bytes in memory at the moment it decided not to
   * send them, and that is one mistaken `return` away from sending them.
   *
   * AND ONLY IF THE CALLER NEEDS THEM (Milestone 9.5, checkpoint A10). The
   * result carries `readBytes` rather than the bytes, so a revalidation whose
   * `If-None-Match` matches is answered `304` after the predicate and before any
   * disk read: a repeat view costs one indexed query and no file I/O. A file
   * missing behind a live row is then noticed on the next full fetch rather than
   * on a revalidation, which is harmless — the visitor already holds exactly
   * the bytes the hash names.
   */
  async findServableRendition(renditionId: string): Promise<ServableRendition> {
    const rows = await this.prisma.$queryRaw<ServableRenditionRow[]>`
      SELECT r.id,
             lower(r.format::text) AS format,
             r.byte_size,
             r.content_hash,
             r.storage_key
      FROM media_rendition r
      JOIN media_asset a ON a.id = r.media_asset_id
      WHERE r.id = ${renditionId}::uuid
        AND a.status = 'ACTIVE'
        -- Erased bytes are refused here rather than at the file read, so the
        -- retention erasure takes effect through the SAME predicate everything
        -- else does.
        AND a.bytes_purged_at IS NULL
        AND r.bytes_purged_at IS NULL
        AND r.storage_key IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM media_attachment ma
          WHERE ma.media_asset_id = a.id
            AND ${LIVE_ATTACHMENT_PREDICATE}
        )
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('MEDIA_NOT_FOUND');

    // Non-null by the predicate above: a NULL key means erased, and an erased
    // rendition never reaches this line.
    const storageKey = row.storage_key as string;

    return {
      format: row.format,
      byteSize: row.byte_size,
      contentHash: row.content_hash,
      readBytes: () => this.storage.read(storageKey),
    };
  }

  /**
   * The published photographs on a set of owners, keyed by owner.
   *
   * ONE STATEMENT FOR A WHOLE PAGE. The team page has a portrait per therapist
   * and the article list has images per article; a per-owner query would be one
   * round trip per row, which is how a listing page becomes slow enough that
   * somebody caches the wrong thing to fix it.
   *
   * `ownerIds` IS EMPTY FOR THE OWNERLESS TYPES, whose attachments name no
   * owner. That case narrows on the six owner columns being null rather than
   * on membership, and it is one branch inside this statement rather than a
   * second method, so it reads through the same predicate as everything else.
   * NOTHING IN THIS PRODUCT CALLS IT WITH `CLINIC_SPACE`: no public projection
   * lists one, before checkpoint A7 or A8 or after either. The clinic-content
   * read DOES call it with `CLINIC_OPEN_GRAPH` (checkpoint A8), which is the
   * first ownerless attachment any page has named.
   *
   * `PUBLIC_SERVICE` TAKES THE ORDINARY BRANCH TOO (Milestone 9.5, checkpoint
   * A9), and the service reads call it with every service they are about to
   * return — one statement for the whole list, exactly as the team page does
   * for portraits. A photograph on a service that is private, retired or
   * unaddressable is excluded by `LIVE_ATTACHMENT_PREDICATE` and not by the
   * caller, so the two service reads cannot disagree with the serving route.
   *
   * `PUBLIC_SPACE` TAKES THE ORDINARY BRANCH, because a space is a real owner
   * row (Milestone 9.5, checkpoint A7). The space gallery is therefore one
   * statement over the same predicate as the team page and the article list,
   * and a photograph on an unpublished space is excluded by
   * `LIVE_ATTACHMENT_PREDICATE` rather than by anything written here.
   */
  async imagesForOwners(
    ownerType: MediaAttachmentOwner,
    ownerIds: readonly string[],
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, PublicImage[]>> {
    const ownerless = isOwnerlessMediaAttachment(ownerType);

    if (!ownerless && ownerIds.length === 0) return new Map();

    // The optional transaction client is what lets the clinic-profile write
    // path read its own gallery inside its own transaction — the same reason
    // `PublicSiteService.getClinicProfile` takes one. Without it the write path
    // would read on a second connection and could report a gallery from before
    // its own uncommitted change.
    const client = tx ?? this.prisma;

    // An ownerless attachment carries no owner id at all, so the narrowing is
    // "all six owner columns are null" rather than a membership test. Stated
    // as one branch here rather than as a second method, so that both shapes go
    // through the same statement and therefore the same predicate.
    const ownerNarrowing = ownerless
      ? Prisma.sql`ma.therapist_id IS NULL AND ma.article_id IS NULL
                   AND ma.testimonial_id IS NULL AND ma.space_id IS NULL
                   AND ma.content_entry_id IS NULL AND ma.service_id IS NULL`
      : Prisma.sql`coalesce(
            ma.therapist_id, ma.article_id, ma.testimonial_id, ma.space_id,
            ma.content_entry_id, ma.service_id
          ) = ANY (${[...ownerIds]}::uuid[])`;

    const rows = await client.$queryRaw<OwnerImageRow[]>`
      SELECT coalesce(
               ma.therapist_id, ma.article_id, ma.testimonial_id, ma.space_id,
               ma.content_entry_id, ma.service_id, ${OWNERLESS_ATTACHMENT_KEY}::uuid
             ) AS owner_key,
             ma.position,
             ma.focal_x,
             ma.focal_y,
             ma.crop_x,
             ma.crop_y,
             ma.crop_width,
             ma.crop_height,
             a.id AS media_id,
             a.alt_text,
             r.id AS rendition_id,
             lower(r.format::text) AS format,
             r.width,
             r.height,
             r.byte_size
      FROM media_attachment ma
      JOIN media_asset a ON a.id = ma.media_asset_id AND a.status = 'ACTIVE'
      JOIN media_rendition r ON r.media_asset_id = a.id
        AND r.bytes_purged_at IS NULL
      WHERE a.bytes_purged_at IS NULL
        AND ma.owner_type = ${ownerType}::media_attachment_owner
        AND ${ownerNarrowing}
        AND ${LIVE_ATTACHMENT_PREDICATE}
      ORDER BY ma.position, ma.id, r.width, r.format
    `;

    const byOwner = new Map<string, PublicImage[]>();
    // Grouping key only. The asset id never enters a `PublicImage` (checkpoint
    // A10): a visitor identifies a photograph by its rendition paths alone.
    const byUse = new Map<string, PublicImage>();

    for (const row of rows) {
      const images = byOwner.get(row.owner_key) ?? [];
      const use = `${row.owner_key}:${row.media_id}`;
      const existing = byUse.get(use);
      const rendition = {
        path: `${PUBLIC_MEDIA_PATH_PREFIX}${row.rendition_id}`,
        format: row.format,
        width: row.width,
        height: row.height,
        byteSize: row.byte_size,
      };

      if (existing === undefined) {
        const image: PublicImage = {
          alt: row.alt_text,
          // Filled in below from the widest rendition: the ORDER BY delivers
          // renditions ascending, so the last one seen is the largest.
          width: row.width,
          height: row.height,
          renditions: [rendition],
          // Framing travels with the image because it belongs to THIS use of
          // it. The same master under a different attachment carries different
          // numbers, and the renditions are identical in both.
          framing: toFraming(row),
        };
        images.push(image);
        byUse.set(use, image);
        byOwner.set(row.owner_key, images);
        continue;
      }

      existing.renditions.push(rendition);
    }

    for (const images of byOwner.values()) {
      for (const image of images) {
        const widest = image.renditions.reduce((a, b) => (b.width > a.width ? b : a));
        image.width = widest.width;
        image.height = widest.height;
      }
    }

    return byOwner;
  }
}

/**
 * The map key standing in for "the clinic itself" — the key every ownerless
 * attachment lands under.
 *
 * A fixed all-zero UUID rather than a string like `clinic`, so the `coalesce`
 * above stays UUID-typed and PostgreSQL does not have to be told to cast a
 * column of one type into a column of another. It never leaves this file and
 * appears in no response.
 *
 * ONE KEY IS ENOUGH FOR BOTH OWNERLESS TYPES because a caller asks for one
 * `ownerType` at a time and the statement narrows on it: a `CLINIC_SPACE` read
 * and a `CLINIC_OPEN_GRAPH` read never share a result map.
 *
 * EXPORTED SO THE ONE PROJECTION THAT READS AN OWNERLESS GALLERY DOES NOT WRITE
 * OUT A SECOND RUN OF ZEROS (Milestone 9.5, checkpoint A8). Two copies of a
 * sentinel are two places to change it.
 */
export const OWNERLESS_ATTACHMENT_KEY = '00000000-0000-0000-0000-000000000000';

export type ServableRendition = {
  readonly format: MediaRenditionFormat;
  readonly byteSize: number;
  readonly contentHash: string;
  /** Reads the file. Called only once the caller knows it must send a body. */
  readonly readBytes: () => Promise<Buffer>;
};

type ServableRenditionRow = {
  id: string;
  format: MediaRenditionFormat;
  byte_size: number;
  content_hash: string;
  storage_key: string;
};

type OwnerImageRow = {
  owner_key: string;
  position: number;
  focal_x: number;
  focal_y: number;
  crop_x: number | null;
  crop_y: number | null;
  crop_width: number | null;
  crop_height: number | null;
  media_id: string;
  /** Never null here: an erased asset fails `a.bytes_purged_at IS NULL` above. */
  alt_text: string;
  rendition_id: string;
  format: MediaRenditionFormat;
  width: number;
  height: number;
  byte_size: number;
};

/**
 * The six framing columns as the one shape both tiers agree on.
 *
 * The crop is present only when all four of its columns are — which
 * `media_attachment_crop_chk` already guarantees, so the check here is a
 * narrowing for TypeScript rather than a second rule.
 */
export function toFraming(row: {
  focal_x: number;
  focal_y: number;
  crop_x: number | null;
  crop_y: number | null;
  crop_width: number | null;
  crop_height: number | null;
}): MediaFraming {
  const cropped =
    row.crop_x !== null &&
    row.crop_y !== null &&
    row.crop_width !== null &&
    row.crop_height !== null;

  return {
    focalX: row.focal_x,
    focalY: row.focal_y,
    crop: cropped
      ? {
          x: row.crop_x as number,
          y: row.crop_y as number,
          width: row.crop_width as number,
          height: row.crop_height as number,
        }
      : null,
  };
}
