import { Prisma } from '@prisma/client';
import type { MediaAttachmentOwner, MediaPublicationIdentity } from '@clinic/contracts';
import { OWNER_IS_PUBLIC } from './media-visibility';

/**
 * The cache identity the Web tier invalidates from, for every attachment the
 * caller's `where` selects (it is applied to `media_attachment ma`).
 *
 * Read INSIDE the mutation transaction by both callers. Reading it afterwards
 * would let a concurrent detach remove the row before the Web tier learns what
 * must be invalidated.
 */
export async function readPublicationIdentities(
  tx: Prisma.TransactionClient,
  where: Prisma.Sql,
): Promise<MediaPublicationIdentity[]> {
  const rows = await tx.$queryRaw<PublicationIdentityRow[]>`
    SELECT
      ma.id AS attachment_id,
      ma.owner_type::text AS owner_type,
      coalesce(
        ma.therapist_id, ma.article_id, ma.testimonial_id, ma.space_id,
        ma.content_entry_id, ma.service_id
      ) AS owner_id,
      CASE ma.owner_type
        WHEN 'PUBLIC_SERVICE' THEN (
          SELECT s.public_slug FROM service s WHERE s.id = ma.service_id
        )
        WHEN 'THERAPIST_PROFILE' THEN (
          SELECT t.public_slug FROM therapist t WHERE t.id = ma.therapist_id
        )
        WHEN 'PUBLIC_ARTICLE' THEN (
          SELECT a.public_slug FROM public_article a WHERE a.id = ma.article_id
        )
        ELSE NULL
      END AS public_slug,
      (${OWNER_IS_PUBLIC}) AS owner_is_public,
      ARRAY(
        SELECT mr.id
        FROM media_rendition mr
        WHERE mr.media_asset_id = ma.media_asset_id
        ORDER BY mr.id
      ) AS rendition_ids
    FROM media_attachment ma
    WHERE ${where}
    ORDER BY ma.position, ma.id
  `;

  return rows.map((row) => ({
    attachmentId: row.attachment_id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    publicSlug: row.public_slug,
    ownerIsPublic: row.owner_is_public,
    renditionIds: row.rendition_ids,
  }));
}

type PublicationIdentityRow = {
  attachment_id: string;
  owner_type: MediaAttachmentOwner;
  owner_id: string | null;
  public_slug: string | null;
  owner_is_public: boolean;
  rendition_ids: string[];
};
