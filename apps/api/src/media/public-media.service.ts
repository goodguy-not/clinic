import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PUBLIC_MEDIA_PATH_PREFIX,
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
        -- Erased bytes are refused here rather than at the file read, so a
        -- future retention policy takes effect through the SAME predicate
        -- everything else does. Nothing writes these markers today.
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

    return {
      format: row.format,
      byteSize: row.byte_size,
      contentHash: row.content_hash,
      // Non-null by the predicate above: a NULL key means erased, and an erased
      // rendition never reaches this line.
      bytes: await this.storage.read(row.storage_key as string),
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
   * `ownerIds` IS EMPTY FOR `CLINIC_SPACE`, whose attachments name no owner.
   * That case narrows on the three owner columns being null rather than on
   * membership, and it is one branch inside this statement rather than a second
   * method, so the clinic gallery reads through the same predicate as
   * everything else.
   */
  async imagesForOwners(
    ownerType: MediaAttachmentOwner,
    ownerIds: readonly string[],
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, PublicImage[]>> {
    if (ownerType !== 'CLINIC_SPACE' && ownerIds.length === 0) return new Map();

    // The optional transaction client is what lets the clinic-profile write
    // path read its own gallery inside its own transaction — the same reason
    // `PublicSiteService.getClinicProfile` takes one. Without it the write path
    // would read on a second connection and could report a gallery from before
    // its own uncommitted change.
    const client = tx ?? this.prisma;

    // `CLINIC_SPACE` rows carry no owner id at all, so the narrowing is "all
    // three owner columns are null" rather than a membership test. Stated as
    // one branch here rather than as a second method, so that both shapes go
    // through the same statement and therefore the same predicate.
    const ownerNarrowing =
      ownerType === 'CLINIC_SPACE'
        ? Prisma.sql`ma.therapist_id IS NULL AND ma.article_id IS NULL AND ma.testimonial_id IS NULL`
        : Prisma.sql`coalesce(ma.therapist_id, ma.article_id, ma.testimonial_id) = ANY (${[
            ...ownerIds,
          ]}::uuid[])`;

    const rows = await client.$queryRaw<OwnerImageRow[]>`
      SELECT coalesce(
               ma.therapist_id, ma.article_id, ma.testimonial_id, ${CLINIC_SPACE_KEY}::uuid
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

    for (const row of rows) {
      const images = byOwner.get(row.owner_key) ?? [];
      const existing = images.find((image) => image.mediaId === row.media_id);
      const rendition = {
        path: `${PUBLIC_MEDIA_PATH_PREFIX}${row.rendition_id}`,
        format: row.format,
        width: row.width,
        height: row.height,
        byteSize: row.byte_size,
      };

      if (existing === undefined) {
        images.push({
          mediaId: row.media_id,
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
        });
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
 * The map key standing in for "the clinic itself".
 *
 * A fixed all-zero UUID rather than a string like `clinic`, so the `coalesce`
 * above stays UUID-typed and PostgreSQL does not have to be told to cast a
 * column of one type into a column of another. It never leaves this file and
 * appears in no response.
 */
const CLINIC_SPACE_KEY = '00000000-0000-0000-0000-000000000000';

export type ServableRendition = {
  readonly format: MediaRenditionFormat;
  readonly byteSize: number;
  readonly contentHash: string;
  readonly bytes: Buffer;
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
