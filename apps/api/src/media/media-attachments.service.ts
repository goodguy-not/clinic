import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  isOwnerlessMediaAttachment,
  type CreateMediaAttachmentRequest,
  type MediaAsset,
  type MediaAttachmentOwner,
  type UpdateMediaFramingRequest,
} from '@clinic/contracts';
import { AuditService } from '../audit/audit.service';
import { actorContext } from '../catalog/catalog-support';
import { AppError } from '../common/app-error';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { uuidv7 } from '../common/uuid';
import { PrismaService } from '../prisma/prisma.service';
import { MediaService } from './media.service';

/**
 * Where a photograph is, and whether the world may see it there.
 *
 * Milestone 9.5, checkpoint A5. THREE ACTS ACROSS TWO AUTHORITIES, and the
 * boundary between them is the whole point of this file:
 *
 *   attach ......... `media.attach`  — receptionist. ALWAYS A DRAFT.
 *   setFraming ..... `media.attach`  — receptionist, and REFUSED while published.
 *   detach ......... `media.attach`  — receptionist, and REFUSED while published.
 *   setPublished ... `media.publish` — manager. Both directions.
 *
 * ATTACHING CANNOT PUBLISH, AND NOT BY CONVENTION. `publishedAt` is not a field
 * on the attach request, so there is no value a caller holding only
 * `media.attach` could send that would make a photograph visible; the row is
 * inserted with a NULL publication instant, and the serving predicate refuses a
 * NULL. It is `article.draft` and `article.publish` applied to a picture, and
 * it is the same promise: a receptionist prepares a change and the page does
 * not move until a manager publishes it.
 *
 * DETACHING A PUBLISHED ATTACHMENT IS REFUSED, AND THAT REFUSAL IS THE
 * INTERESTING ONE. Without it, `media.attach` would be a back door to taking a
 * photograph off a live page — the weaker authority undoing the stronger one's
 * decision by removing the row it was recorded on. So a published attachment
 * must be unpublished first, which only a manager can do, and only then
 * detached. `MEDIA_ATTACHMENT_PUBLISHED` is that refusal.
 *
 * THE OWNER MUST EXIST AND THE DATABASE ENFORCES IT. Five real foreign keys
 * under one discriminator — `space_id` was added in checkpoint A7 and
 * `content_entry_id` in A8 — with `media_attachment_owner_chk` requiring
 * exactly the matching column and refusing the other four, so an attachment
 * cannot name an article that is not there and cannot quietly name two owners
 * at once. This service checks first anyway, in order to return
 * `ARTICLE_NOT_FOUND` rather than a constraint violation — the check is for the
 * message, the constraint is for the guarantee.
 *
 * ARCHIVED ASSETS MAY NOT BE ATTACHED OR PUBLISHED. Archiving is a manager
 * saying "not this photograph, anywhere"; letting it be attached afterwards
 * would leave a page that silently becomes populated the moment somebody
 * restores it.
 *
 * `setFraming` IS THE NARROWEST WRITE IN THE SUBSYSTEM AND THE ONLY ONE THAT
 * MOVES NO BYTE. Framing is a description of which part of an existing picture
 * matters — it is never encoded into the pixels, no rendition is re-derived,
 * and the master is not read, let alone rewritten. That is what makes
 * "re-frame without re-uploading" true rather than merely convenient: there is
 * no path from this method to the encoder at all.
 */
@Injectable()
export class MediaAttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly media: MediaService,
  ) {}

  /**
   * Put a photograph somewhere. Behind `media.attach`, and always unpublished.
   *
   * Returns the whole asset rather than the attachment, because the question a
   * caller has after attaching is "where is this photograph now, and is any of
   * it visible?" — which is the asset's shape, not the row that was inserted.
   */
  async attach(
    mediaId: string,
    input: CreateMediaAttachmentRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<MediaAsset> {
    const owner = normalizeOwner(input.ownerType, input.ownerId);

    await this.prisma.$transaction(async (tx) => {
      const asset = await lockAsset(tx, mediaId);

      if (asset.status === 'ARCHIVED') throw new AppError('MEDIA_ARCHIVED');

      await assertOwnerExists(tx, owner);

      const existing = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM media_attachment
        WHERE media_asset_id = ${mediaId}::uuid
          AND owner_type = ${owner.ownerType}::media_attachment_owner
          AND therapist_id IS NOT DISTINCT FROM ${owner.therapistId}::uuid
          AND article_id IS NOT DISTINCT FROM ${owner.articleId}::uuid
          AND testimonial_id IS NOT DISTINCT FROM ${owner.testimonialId}::uuid
          AND space_id IS NOT DISTINCT FROM ${owner.spaceId}::uuid
          AND content_entry_id IS NOT DISTINCT FROM ${owner.contentEntryId}::uuid
          AND detached_at IS NULL
      `;

      if (existing[0] !== undefined) throw new AppError('MEDIA_ALREADY_ATTACHED');

      const id = uuidv7();

      await tx.$executeRaw`
        INSERT INTO media_attachment (
          id, media_asset_id, owner_type, therapist_id, article_id, testimonial_id, space_id,
          content_entry_id, position, attached_at, attached_by_user_id
        ) VALUES (
          ${id}::uuid, ${mediaId}::uuid, ${owner.ownerType}::media_attachment_owner,
          ${owner.therapistId}::uuid, ${owner.articleId}::uuid, ${owner.testimonialId}::uuid,
          ${owner.spaceId}::uuid, ${owner.contentEntryId}::uuid,
          ${input.position}, transaction_timestamp(), ${actor.userId}::uuid
        )
      `;

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'media.attached',
        entityType: 'media_attachment',
        entityId: id,
        after: {
          mediaAssetId: mediaId,
          ownerType: owner.ownerType,
          ownerId: owner.ownerId,
          position: input.position,
          published: false,
        },
      });
    });

    return this.media.get(mediaId);
  }

  /**
   * Take a photograph off a page. Behind `media.attach`, and refused while the
   * attachment is published — see the note above.
   *
   * The row is UPDATED, never deleted. What remains is the record that this
   * picture was on that article between these two instants, which is the only
   * way anybody afterwards can answer a family asking when their child's
   * photograph came off the site.
   */
  async detach(
    attachmentId: string,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<MediaAsset> {
    const mediaId = await this.prisma.$transaction(async (tx) => {
      const attachment = await lockAttachment(tx, attachmentId);

      if (attachment.published_at !== null) throw new AppError('MEDIA_ATTACHMENT_PUBLISHED');

      await tx.$executeRaw`
        UPDATE media_attachment
        SET detached_at = transaction_timestamp(), detached_by_user_id = ${actor.userId}::uuid
        WHERE id = ${attachmentId}::uuid
      `;

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'media.detached',
        entityType: 'media_attachment',
        entityId: attachmentId,
        before: {
          mediaAssetId: attachment.media_asset_id,
          ownerType: attachment.owner_type,
          ownerId: attachment.owner_id,
          published: false,
        },
        after: { detached: true },
      });

      return attachment.media_asset_id;
    });

    return this.media.get(mediaId);
  }

  /**
   * Re-frame this use of the photograph. Behind `media.attach`.
   *
   * NO BYTE MOVES. The stored renditions are the whole frame and stay the whole
   * frame; these six numbers say which part of it matters, and the web tier
   * applies them. Nothing here reads the master, nothing re-derives a rendition,
   * and nothing can destroy the parts of the photograph outside the crop — which
   * is the entire reason a crop is stored as a description rather than baked in.
   * Re-framing is therefore reversible for ever, and re-framing a hundred times
   * costs the same as re-framing once.
   *
   * REFUSED WHILE THE ATTACHMENT IS PUBLISHED, exactly as detaching is. A
   * receptionist holding `media.attach` must not be able to change what is on a
   * live page; a manager re-frames by unpublishing, re-framing and republishing,
   * which is three audited acts instead of one silent one.
   *
   * THE CROP IS ALL-OR-NOTHING, and `media_attachment_crop_chk` says so in the
   * database as well. Clearing it is `crop: null`, which is the normal state.
   */
  async setFraming(
    attachmentId: string,
    framing: UpdateMediaFramingRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<MediaAsset> {
    const mediaId = await this.prisma.$transaction(async (tx) => {
      const attachment = await lockAttachment(tx, attachmentId);

      if (attachment.published_at !== null) throw new AppError('MEDIA_ATTACHMENT_PUBLISHED');

      const crop = framing.crop;

      await tx.$executeRaw`
        UPDATE media_attachment
        SET focal_x = ${framing.focalX},
            focal_y = ${framing.focalY},
            crop_x = ${crop === null ? null : crop.x},
            crop_y = ${crop === null ? null : crop.y},
            crop_width = ${crop === null ? null : crop.width},
            crop_height = ${crop === null ? null : crop.height}
        WHERE id = ${attachmentId}::uuid
      `;

      // The framing itself is the audit payload, before and after. It is six
      // small numbers describing a rectangle — no image content, nothing about
      // a family, nothing that could not be read off the page — so unlike the
      // other payloads in this module there is nothing here to reduce.
      await this.audit.record(tx, actorContext(actor, context), {
        action: 'media.reframed',
        entityType: 'media_attachment',
        entityId: attachmentId,
        before: framingAudit(attachment),
        after: {
          focalX: framing.focalX,
          focalY: framing.focalY,
          cropX: crop === null ? null : crop.x,
          cropY: crop === null ? null : crop.y,
          cropWidth: crop === null ? null : crop.width,
          cropHeight: crop === null ? null : crop.height,
        },
      });

      return attachment.media_asset_id;
    });

    return this.media.get(mediaId);
  }

  /**
   * The manager act, in both directions. Behind `media.publish`.
   *
   * PUBLISHING IS ONE OF TWO GATES AND NEVER BOTH. It says a manager has looked
   * at this photograph in this place and approved it; whether a visitor sees
   * anything additionally depends on the owner being public, which is a
   * different decision on a different screen. Publishing an image on a draft
   * article is therefore legal, silent, and exactly what somebody preparing a
   * launch wants.
   *
   * UNPUBLISHING IS IMMEDIATE AT THE ORIGIN. The next anonymous request for any
   * rendition of this asset through this attachment is refused, with no
   * interval — the predicate is re-evaluated per request against this row.
   * Caches beyond the origin are bounded by
   * `PUBLIC_MEDIA_REVOCATION_WINDOW_SECONDS`; copies that have already left are
   * bounded by nothing, and nothing in this product should be described as if
   * they were.
   */
  async setPublished(
    attachmentId: string,
    isPublished: boolean,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<MediaAsset> {
    const mediaId = await this.prisma.$transaction(async (tx) => {
      const attachment = await lockAttachment(tx, attachmentId);

      if (isPublished) {
        const asset = await lockAsset(tx, attachment.media_asset_id);
        if (asset.status === 'ARCHIVED') throw new AppError('MEDIA_ARCHIVED');
      }

      const wasPublished = attachment.published_at !== null;
      if (wasPublished === isPublished) return attachment.media_asset_id;

      await tx.$executeRaw`
        UPDATE media_attachment
        SET published_at = ${isPublished ? Prisma.sql`transaction_timestamp()` : Prisma.sql`NULL`},
            published_by_user_id = ${
              isPublished ? Prisma.sql`${actor.userId}::uuid` : Prisma.sql`NULL`
            }
        WHERE id = ${attachmentId}::uuid
      `;

      await this.audit.record(tx, actorContext(actor, context), {
        action: isPublished ? 'media.published' : 'media.unpublished',
        entityType: 'media_attachment',
        entityId: attachmentId,
        before: { published: wasPublished },
        after: { published: isPublished },
        metadata: {
          mediaAssetId: attachment.media_asset_id,
          ownerType: attachment.owner_type,
          ownerId: attachment.owner_id,
        },
      });

      return attachment.media_asset_id;
    });

    return this.media.get(mediaId);
  }
}

/**
 * The discriminator turned into the five owner columns the table actually holds.
 *
 * TWO OWNER TYPES NAME NOTHING AND FIVE NAME EXACTLY ONE ROW.
 * `MEDIA_OWNERLESS_ATTACHMENT_OWNERS` is the list, stated once in the shared
 * contract rather than as a `!== 'CLINIC_SPACE'` in each place that needs it.
 *
 * `CLINIC_SPACE` AND `PUBLIC_SPACE` ARE EASY TO CONFUSE BY NAME AND ARE
 * OPPOSITES HERE: a `CLINIC_SPACE` attachment names nothing and the request must
 * not supply an owner id, while a `PUBLIC_SPACE` attachment names one
 * `public_space` row and must, exactly as a therapist, article or testimonial
 * attachment does (Milestone 9.5, checkpoint A7). `CLINIC_OPEN_GRAPH` joins the
 * first group and `CLINIC_CONTENT_ENTRY` the second (checkpoint A8).
 *
 * Refused as `VALIDATION_FAILED` rather than silently ignored, because "I sent
 * an owner id and it was dropped" is how a photograph ends up on the wrong page
 * — and here it is also how a photograph ends up in an ownerless slot no
 * publication can ever withdraw.
 */
function normalizeOwner(
  ownerType: MediaAttachmentOwner,
  ownerId: string | null,
): {
  ownerType: MediaAttachmentOwner;
  ownerId: string | null;
  therapistId: string | null;
  articleId: string | null;
  testimonialId: string | null;
  spaceId: string | null;
  contentEntryId: string | null;
} {
  const wantsOwner = !isOwnerlessMediaAttachment(ownerType);

  if (wantsOwner !== (ownerId !== null)) {
    throw new AppError(
      'VALIDATION_FAILED',
      undefined,
      wantsOwner ? 'This owner type requires an owner id' : 'This attachment names no owner id',
    );
  }

  return {
    ownerType,
    ownerId,
    therapistId: ownerType === 'THERAPIST_PROFILE' ? ownerId : null,
    articleId: ownerType === 'PUBLIC_ARTICLE' ? ownerId : null,
    testimonialId: ownerType === 'PUBLIC_TESTIMONIAL' ? ownerId : null,
    spaceId: ownerType === 'PUBLIC_SPACE' ? ownerId : null,
    contentEntryId: ownerType === 'CLINIC_CONTENT_ENTRY' ? ownerId : null,
  };
}

/**
 * The owner has to be there.
 *
 * The foreign keys guarantee it; this exists so the caller is told WHICH thing
 * is missing, in the vocabulary the rest of the product already uses, rather
 * than receiving a constraint violation as an `INTERNAL_ERROR`.
 */
async function assertOwnerExists(
  tx: Prisma.TransactionClient,
  owner: { ownerType: MediaAttachmentOwner; ownerId: string | null },
): Promise<void> {
  if (owner.ownerId === null) return;

  const found = await (async () => {
    switch (owner.ownerType) {
      case 'THERAPIST_PROFILE':
        return tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM therapist WHERE id = ${owner.ownerId}::uuid
        `;
      case 'PUBLIC_ARTICLE':
        return tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM public_article WHERE id = ${owner.ownerId}::uuid
        `;
      case 'PUBLIC_TESTIMONIAL':
        return tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM public_testimonial WHERE id = ${owner.ownerId}::uuid
        `;
      case 'PUBLIC_SPACE':
        return tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM public_space WHERE id = ${owner.ownerId}::uuid
        `;
      case 'CLINIC_CONTENT_ENTRY':
        return tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM clinic_content_entry WHERE id = ${owner.ownerId}::uuid
        `;
      case 'CLINIC_SPACE':
      case 'CLINIC_OPEN_GRAPH':
        return [];
    }
  })();

  if (found[0] !== undefined) return;

  switch (owner.ownerType) {
    case 'THERAPIST_PROFILE':
      throw new AppError('THERAPIST_NOT_FOUND');
    case 'PUBLIC_ARTICLE':
      throw new AppError('ARTICLE_NOT_FOUND');
    case 'PUBLIC_TESTIMONIAL':
      throw new AppError('TESTIMONIAL_NOT_FOUND');
    case 'PUBLIC_SPACE':
      throw new AppError('PUBLIC_SPACE_NOT_FOUND');
    case 'CLINIC_CONTENT_ENTRY':
      throw new AppError('CLINIC_CONTENT_ENTRY_NOT_FOUND');
    case 'CLINIC_SPACE':
    case 'CLINIC_OPEN_GRAPH':
      return;
  }
}

async function lockAsset(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<{ status: 'ACTIVE' | 'ARCHIVED' }> {
  const rows = await tx.$queryRaw<{ status: 'ACTIVE' | 'ARCHIVED' }[]>`
    SELECT status::text AS status FROM media_asset WHERE id = ${id}::uuid FOR UPDATE
  `;

  const row = rows[0];
  if (row === undefined) throw new AppError('MEDIA_NOT_FOUND');
  return row;
}

type LockedAttachment = {
  media_asset_id: string;
  owner_type: MediaAttachmentOwner;
  owner_id: string | null;
  published_at: Date | null;
  focal_x: number;
  focal_y: number;
  crop_x: number | null;
  crop_y: number | null;
  crop_width: number | null;
  crop_height: number | null;
};

/** The framing an audit row records as the state before a re-frame. */
function framingAudit(row: LockedAttachment): Record<string, number | null> {
  return {
    focalX: row.focal_x,
    focalY: row.focal_y,
    cropX: row.crop_x,
    cropY: row.crop_y,
    cropWidth: row.crop_width,
    cropHeight: row.crop_height,
  };
}

/**
 * A detached attachment is `MEDIA_ATTACHMENT_NOT_FOUND`, the same as one that
 * never existed. The fix in both cases is to attach the photograph again, and
 * two codes would be two words for one instruction.
 */
async function lockAttachment(tx: Prisma.TransactionClient, id: string): Promise<LockedAttachment> {
  const rows = await tx.$queryRaw<LockedAttachment[]>`
    SELECT media_asset_id,
           owner_type::text AS owner_type,
           coalesce(therapist_id, article_id, testimonial_id, space_id, content_entry_id) AS owner_id,
           published_at,
           focal_x,
           focal_y,
           crop_x,
           crop_y,
           crop_width,
           crop_height
    FROM media_attachment
    WHERE id = ${id}::uuid AND detached_at IS NULL
    FOR UPDATE
  `;

  const row = rows[0];
  if (row === undefined) throw new AppError('MEDIA_ATTACHMENT_NOT_FOUND');
  return row;
}
