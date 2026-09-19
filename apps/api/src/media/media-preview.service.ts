import { Injectable } from '@nestjs/common';
import {
  MEDIA_ATTACHMENT_OWNERS,
  type MediaAttachmentOwner,
  type MediaRenditionFormat,
  type Permission,
} from '@clinic/contracts';
import { AppError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { MediaStorageService } from './media-storage.service';
import type { ServableRendition } from './public-media.service';

/**
 * WHICH READ AUTHORITY SEES A PHOTOGRAPH IN WHICH PLACE, BEFORE IT IS PUBLIC.
 *
 * Milestone 9.5, the staff-preview checkpoint. An unpublished photograph is
 * part of the draft it is attached to, so seeing it is READING THAT DRAFT, and
 * the name for reading it is the one the owner's own internal read already
 * demands. Nothing here is a new authority: every value is a permission an
 * existing `GET` route is behind.
 *
 *   THERAPIST_PROFILE ...... `therapist.draft_public_profile` — the read of a
 *                            colleague's draft public profile. Not
 *                            `therapist.read`, which is the operational record.
 *   PUBLIC_ARTICLE ......... `article.read`
 *   PUBLIC_TESTIMONIAL ..... `testimonial.read`
 *   PUBLIC_SPACE ........... `public_space.read`
 *   CLINIC_CONTENT_ENTRY ... `clinic_profile.read` — the entries hang off the
 *   CLINIC_OPEN_GRAPH ...... `clinic_profile.read`   clinic profile, which is
 *   CLINIC_SPACE ........... `clinic_profile.read`   the manager's surface.
 *
 * `CLINIC_SPACE` FOLLOWS ITS OWNER, NOT ITS USE AS A PARKING SLOT. The web tier
 * parks unplaced uploads there, but A5 defines it as the clinic's own photograph
 * hanging off the always-live clinic profile, and `media-visibility.ts` treats
 * it that way. So a receptionist who parked a picture there cannot preview it
 * later; a manager can. Widening that is a product decision, not an inference.
 *
 * `Record<MediaAttachmentOwner, ...>` MAKES THIS EXHAUSTIVE: a new owner type is
 * a compile error here until somebody decides who may see its drafts.
 */
export const MEDIA_PREVIEW_OWNER_PERMISSION: Record<MediaAttachmentOwner, Permission> = {
  THERAPIST_PROFILE: 'therapist.draft_public_profile',
  PUBLIC_ARTICLE: 'article.read',
  PUBLIC_TESTIMONIAL: 'testimonial.read',
  PUBLIC_SPACE: 'public_space.read',
  CLINIC_CONTENT_ENTRY: 'clinic_profile.read',
  CLINIC_OPEN_GRAPH: 'clinic_profile.read',
  CLINIC_SPACE: 'clinic_profile.read',
};

/** The owner types whose drafts a holder of these permissions may read. */
export function previewableOwnerTypes(permissions: readonly Permission[]): MediaAttachmentOwner[] {
  return MEDIA_ATTACHMENT_OWNERS.filter((owner) =>
    permissions.includes(MEDIA_PREVIEW_OWNER_PERMISSION[owner]),
  );
}

/**
 * A signed-in colleague's view of a rendition's bytes, published or not.
 *
 * Milestone 9.5, the staff-preview checkpoint. A5 deliberately had no such
 * path, reasoning that a second serving predicate would be the one that is
 * wrong. This one exists because a manager cannot approve a picture they cannot
 * see, and it is kept safe by being a DIFFERENT QUESTION rather than a looser
 * copy of the public one: it never answers a request without a session (its
 * route is behind `media.read`), it never feeds a public cache
 * (`MEDIA_PREVIEW_CACHE_CONTROL`), and `LIVE_ATTACHMENT_PREDICATE` — the rule
 * for strangers — is neither imported nor changed.
 *
 * THE RULE, ALL REQUIRED:
 *
 *  1. THE ASSET IS IN CIRCULATION AND THE BYTES EXIST — the same first
 *     condition the public route applies. Archived or erased is refused here
 *     too: previewing does not reach past a manager's "not this photograph".
 *  2. A STANDING ATTACHMENT PUTS IT ON AN OWNER THE CALLER MAY READ. Publication
 *     is not consulted in either direction. An unattached upload, or one whose
 *     only attachments are detached, belongs to no draft and is refused; so is
 *     one attached only where the caller's role cannot read.
 *
 * ONLY `media_rendition` IS READ, SO THE MASTER IS UNREACHABLE HERE for the
 * reason it is unreachable publicly: it has no row an identifier could name.
 * The bytes are the re-encoded, metadata-free renditions A5 already stores.
 *
 * ONE REFUSAL, `MEDIA_NOT_FOUND`, for every reason. A colleague holding
 * `media.read` can already list the library, so this is not hiding existence
 * from them; it is keeping one answer so the web tier has one branch.
 *
 * NOT AUDITED, like every other staff read of a draft. Nothing changes.
 */
@Injectable()
export class MediaPreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MediaStorageService,
  ) {}

  async findPreviewableRendition(
    renditionId: string,
    permissions: readonly Permission[],
  ): Promise<ServableRendition> {
    const owners = previewableOwnerTypes(permissions);
    if (owners.length === 0) throw new AppError('MEDIA_NOT_FOUND');

    const rows = await this.prisma.$queryRaw<PreviewRow[]>`
      SELECT lower(r.format::text) AS format,
             r.byte_size,
             r.content_hash,
             r.storage_key
      FROM media_rendition r
      JOIN media_asset a ON a.id = r.media_asset_id
      WHERE r.id = ${renditionId}::uuid
        AND a.status = 'ACTIVE'
        AND a.bytes_purged_at IS NULL
        AND r.bytes_purged_at IS NULL
        AND r.storage_key IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM media_attachment ma
          WHERE ma.media_asset_id = a.id
            AND ma.detached_at IS NULL
            AND ma.owner_type::text = ANY (${owners}::text[])
        )
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('MEDIA_NOT_FOUND');

    // As on the public route, the file is read only after the row said yes.
    return {
      format: row.format,
      byteSize: row.byte_size,
      contentHash: row.content_hash,
      bytes: await this.storage.read(row.storage_key),
    };
  }
}

type PreviewRow = {
  format: MediaRenditionFormat;
  byte_size: number;
  content_hash: string;
  storage_key: string;
};
