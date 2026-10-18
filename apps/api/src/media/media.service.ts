import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PUBLIC_MEDIA_PATH_PREFIX,
  type MediaAltTextResponse,
  type MediaAsset,
  type MediaAssetStatus,
  type MediaAttachment,
  type MediaAttachmentOwner,
  type MediaContentType,
  type MediaRendition,
  type MediaRenditionFormat,
} from '@clinic/contracts';
import { AuditService } from '../audit/audit.service';
import { actorContext, canonicalText } from '../catalog/catalog-support';
import { AppError } from '../common/app-error';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { uuidv7 } from '../common/uuid';
import { PrismaService } from '../prisma/prisma.service';
import { deriveMediaGated } from './image-processing';
import { readPublicationIdentities } from './media-publication-identity';
import {
  assetIsPubliclyServed,
  LIVE_ATTACHMENT_PREDICATE,
  OWNER_IS_PUBLIC,
} from './media-visibility';
import { toFraming } from './public-media.service';
import { MediaStorageService } from './media-storage.service';

/**
 * The media library: uploading a photograph, reading what the clinic has, and
 * taking one out of circulation.
 *
 * Milestone 9.5, checkpoint A5.
 *
 * THE UPLOAD IS THREE STEPS AND THE ORDER MATTERS.
 *
 *  1. DERIVE, IN MEMORY. Sniff the type from the bytes, apply the orientation,
 *     discard every scrap of metadata, and encode a master plus its renditions.
 *     Every refusal a caller can receive about a FILE happens here, before
 *     anything has been written or inserted.
 *  2. WRITE THE FILES. The master and the renditions go to disk under keys this
 *     service generates.
 *  3. INSERT THE ROWS, IN ONE TRANSACTION, WITH THE AUDIT ROW.
 *
 * STEPS 2 AND 3 ARE NOT ATOMIC TOGETHER, AND THEY CANNOT BE: a filesystem does
 * not roll back. The order is chosen so that the failure mode is the harmless
 * one. A transaction that fails after the files are written leaves bytes on
 * disk that NO ROW NAMES — unreachable by every route in this application,
 * because the serving route selects a `media_rendition` and there is none. The
 * reverse order would leave rows pointing at files that do not exist, which is
 * a library full of broken images and a serving route returning 404 for things
 * a manager can see listed as published.
 *
 * THE UPLOADED BYTES ARE NEVER WRITTEN. Not to a temporary directory, not to a
 * quarantine, not to an "originals" folder. They exist as one buffer for the
 * length of one request. That is what makes "no original phone photograph is
 * publicly reachable" a fact about the system rather than a predicate somebody
 * has to keep remembering — and it is why no GPS coordinate from a family's or
 * a colleague's telephone is anywhere in a backup of this product.
 *
 * ARCHIVING IS NOT DELETION AND THIS SERVICE DELETES NOTHING. `setArchived`
 * takes a photograph out of circulation everywhere at once and can put it back.
 * How long the clinic then keeps the bytes is a retention decision the owner
 * has not taken, and there is deliberately no code here that could carry it out
 * before it is taken.
 */
@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: MediaStorageService,
  ) {}

  /**
   * Take an uploaded photograph into the library. Behind `media.upload`.
   *
   * NOTHING THIS PRODUCES IS PUBLIC. A new asset has no attachment, and the
   * serving predicate requires a published attachment on a public owner, so the
   * strongest thing an upload can do is put a picture in front of a colleague.
   */
  async upload(
    source: Buffer,
    altText: string,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<MediaAsset> {
    // A RETRY IS NOT A SECOND PHOTOGRAPH (Milestone 9.5 stabilisation). The
    // digest of the bytes as uploaded is the retry identity: it survives every
    // restart because it lives in PostgreSQL, and it is scoped to the uploader,
    // so a replay can only hand back an asset the caller created. Checked here,
    // before any image processing, so a retry costs one indexed read.
    const sourceHash = createHash('sha256').update(source).digest('hex');
    const replayed = await this.findRetryTarget(this.prisma, actor.userId, sourceHash);
    if (replayed !== null) return this.get(replayed);

    const derived = await deriveMediaGated(source);
    const id = uuidv7();
    const alt = canonicalText(altText);

    const masterKey = this.storage.keyFor(id, 'master.jpg');

    const renditions = derived.renditions.map((rendition) => ({
      ...rendition,
      id: uuidv7(),
      key: this.storage.keyFor(id, `w${rendition.width}.${rendition.format}`),
    }));

    await this.storage.write(masterKey, derived.master.bytes);
    for (const rendition of renditions) {
      await this.storage.write(rendition.key, rendition.bytes);
    }

    const winner = await this.prisma.$transaction(async (tx) => {
      // Two retries racing each other both miss the read above. The advisory
      // lock serialises them on (uploader, digest) for the length of this
      // transaction, and the second re-reads under it and finds the first. The
      // loser's derived files stay on disk named by no row — the harmless
      // failure mode the order of these steps was chosen for.
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${`media-upload:${actor.userId}:${sourceHash}`}, 0))
      `;
      const raced = await this.findRetryTarget(tx, actor.userId, sourceHash);
      if (raced !== null) return raced;

      await tx.$executeRaw`
        INSERT INTO media_asset (
          id, alt_text, status, source_content_type, source_byte_size, source_content_hash,
          master_storage_key, master_content_hash, master_byte_size,
          master_width, master_height, created_at, created_by_user_id
        ) VALUES (
          ${id}::uuid, ${alt}, 'ACTIVE'::media_asset_status,
          ${derived.sourceContentType}, ${source.byteLength}, ${sourceHash},
          ${masterKey}, ${derived.master.contentHash}, ${derived.master.bytes.byteLength},
          ${derived.master.width}, ${derived.master.height},
          transaction_timestamp(), ${actor.userId}::uuid
        )
      `;

      for (const rendition of renditions) {
        await tx.$executeRaw`
          INSERT INTO media_rendition (
            id, media_asset_id, format, width, height, byte_size, content_hash,
            storage_key, created_at
          ) VALUES (
            ${rendition.id}::uuid, ${id}::uuid,
            ${rendition.format.toUpperCase()}::media_rendition_format,
            ${rendition.width}, ${rendition.height}, ${rendition.bytes.byteLength},
            ${rendition.contentHash}, ${rendition.key}, transaction_timestamp()
          )
        `;
      }

      // WHAT THE AUDIT ROW SAYS, AND WHAT IT DELIBERATELY DOES NOT. It records
      // that a photograph entered the library, what kind of file it was, how
      // big, and what was derived from it. It does NOT record the original file
      // name — a caller-chosen string that is very often a family's surname —
      // and it records no byte of image data. `audit_log` is the one table in
      // this schema that can never be deleted or pruned, so anything copied
      // into it is kept permanently by rule.
      await this.audit.record(tx, actorContext(actor, context), {
        action: 'media.uploaded',
        entityType: 'media_asset',
        entityId: id,
        after: {
          sourceContentType: derived.sourceContentType,
          sourceByteSize: source.byteLength,
          masterWidth: derived.master.width,
          masterHeight: derived.master.height,
          renditionCount: renditions.length,
          altTextLength: alt.length,
        },
      });

      return id;
    });

    return this.get(winner);
  }

  /**
   * The asset a retry of these bytes by this colleague should return, if any:
   * theirs, still in circulation, and with its bytes. An archived asset is not
   * matched — re-uploading after archiving is a deliberate new photograph —
   * and neither is a colleague's, so nothing becomes visible or attachable to
   * anybody who could not already reach it.
   */
  private async findRetryTarget(
    client: Prisma.TransactionClient | PrismaService,
    userId: string,
    sourceHash: string,
  ): Promise<string | null> {
    const rows = await client.$queryRaw<{ id: string }[]>`
      SELECT id FROM media_asset
      WHERE created_by_user_id = ${userId}::uuid
        AND source_content_hash = ${sourceHash}
        AND status = 'ACTIVE'::media_asset_status
        AND bytes_purged_at IS NULL
      ORDER BY id
      LIMIT 1
    `;

    return rows[0]?.id ?? null;
  }

  /** The whole library, newest first. Behind `media.read`. */
  async list(): Promise<MediaAsset[]> {
    const rows = await this.prisma.$queryRaw<AssetRow[]>`
      SELECT ${ASSET_COLUMNS} FROM media_asset a ORDER BY a.id DESC
    `;

    return this.hydrate(rows);
  }

  /** One asset with everything a colleague needs to reason about it. */
  async get(id: string): Promise<MediaAsset> {
    const rows = await this.prisma.$queryRaw<AssetRow[]>`
      SELECT ${ASSET_COLUMNS} FROM media_asset a WHERE a.id = ${id}::uuid
    `;

    if (rows[0] === undefined) throw new AppError('MEDIA_NOT_FOUND');

    const hydrated = await this.hydrate(rows);
    const asset = hydrated[0];

    if (asset === undefined) throw new AppError('MEDIA_NOT_FOUND');

    return asset;
  }

  /**
   * Take a photograph out of circulation, or put it back. Behind
   * `media.publish`, which is the manager's alone.
   *
   * ARCHIVING DOES NOT DETACH ANYTHING. The attachments stay exactly as they
   * were, so restoring the asset restores every page it was on rather than
   * requiring somebody to remember where it used to be. What archiving does is
   * fail the first condition of the serving predicate, everywhere at once.
   *
   * IT IS IMMEDIATE AT THE ORIGIN. The next anonymous request for any rendition
   * of this asset is refused, because the predicate is evaluated per request
   * against this row, and the web tier re-asks on every request; copies that
   * have already left are bounded by nothing — see `PUBLIC_MEDIA_CACHE_CONTROL`.
   */
  async setArchived(
    id: string,
    archived: boolean,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<MediaAsset> {
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ status: MediaAssetStatus; erased: boolean }[]>`
        SELECT status::text AS status, bytes_purged_at IS NOT NULL AS erased
        FROM media_asset WHERE id = ${id}::uuid FOR UPDATE
      `;

      const before = locked[0];
      if (before === undefined) throw new AppError('MEDIA_NOT_FOUND');

      const wasArchived = before.status === 'ARCHIVED';
      if (wasArchived === archived) return;

      // Restorable for thirty days, then erased (Milestone 10, checkpoint A3).
      // Once the bytes are gone there is no photograph to put back into
      // circulation, and `media_asset_erasure_guard` refuses it as well.
      if (!archived && before.erased) {
        throw new AppError('MEDIA_NOT_FOUND', undefined, 'This photograph has been erased');
      }

      await tx.$executeRaw`
        UPDATE media_asset
        SET status = ${archived ? 'ARCHIVED' : 'ACTIVE'}::media_asset_status,
            archived_at = ${archived ? Prisma.sql`transaction_timestamp()` : Prisma.sql`NULL`},
            archived_by_user_id = ${archived ? Prisma.sql`${actor.userId}::uuid` : Prisma.sql`NULL`}
        WHERE id = ${id}::uuid
      `;

      await this.audit.record(tx, actorContext(actor, context), {
        action: archived ? 'media.archived' : 'media.restored',
        entityType: 'media_asset',
        entityId: id,
        before: { status: before.status },
        after: { status: archived ? 'ARCHIVED' : 'ACTIVE' },
      });
    });

    return this.get(id);
  }

  /**
   * Correct a photograph's description. Behind `media.attach`.
   *
   * THE DESCRIPTION IS THE ASSET'S. It says what is in the picture, which does
   * not depend on where the picture is used, so one correction reaches every
   * page the photograph is on.
   *
   * THE AUTHORITY FOLLOWS THE PUBLICATION BOUNDARY. While no stranger can be
   * served this photograph, the description is draft material and anybody who
   * may attach may correct it. Once it is served anywhere, the description is
   * public content and changing it is the manager's act (`media.publish`).
   *
   * "SERVED" IS READ AFTER THE ASSET LOCK, IN A SEPARATE STATEMENT, so it sees
   * whatever a concurrent publish or restore — both of which lock this row —
   * committed while this transaction waited. A manager making the OWNER public
   * at the same instant does not lock the asset; that race is the ordinary
   * draft-versus-publish one, and serialises as "corrected, then published".
   *
   * AN ERASED PHOTOGRAPH HAS NO DESCRIPTION TO CORRECT (checkpoint A10). Its
   * description went with its bytes, and writing a new one would store words
   * about a picture that no longer exists — `MEDIA_NOT_FOUND`, the answer every
   * other act on an erased photograph gets.
   */
  async updateAltText(
    id: string,
    altText: string,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<MediaAltTextResponse> {
    const alt = canonicalText(altText);

    const publications = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ alt_text: string | null }[]>`
        SELECT alt_text FROM media_asset WHERE id = ${id}::uuid FOR UPDATE
      `;

      // A null description is exactly an erased photograph
      // (`media_asset_description_erasure_chk`).
      const before = locked[0];
      if (before === undefined || before.alt_text === null) {
        throw new AppError('MEDIA_NOT_FOUND');
      }
      const beforeAlt = before.alt_text;

      const served = await tx.$queryRaw<{ is_publicly_served: boolean }[]>`
        SELECT (${assetIsPubliclyServed('a')}) AS is_publicly_served
        FROM media_asset a WHERE a.id = ${id}::uuid
      `;
      const isPubliclyServed = served[0]?.is_publicly_served === true;

      if (isPubliclyServed && !actor.permissions.includes('media.publish')) {
        throw new AppError(
          'AUTH_FORBIDDEN',
          undefined,
          'Only a manager may change the description of a publicly served photograph',
        );
      }

      if (beforeAlt === alt) return [];

      await tx.$executeRaw`
        UPDATE media_asset SET alt_text = ${alt} WHERE id = ${id}::uuid
      `;

      // Lengths, not the words, exactly as `media.uploaded` records them: a
      // description can name a child, and `audit_log` is never pruned.
      await this.audit.record(tx, actorContext(actor, context), {
        action: 'media.alt_text_updated',
        entityType: 'media_asset',
        entityId: id,
        before: { altTextLength: beforeAlt.length },
        after: { altTextLength: alt.length },
        metadata: { isPubliclyServed },
      });

      if (!isPubliclyServed) return [];

      return readPublicationIdentities(
        tx,
        Prisma.sql`ma.media_asset_id = ${id}::uuid AND ${LIVE_ATTACHMENT_PREDICATE}`,
      );
    });

    return { media: await this.get(id), publications };
  }

  /**
   * Attach the renditions and the attachments to a page of asset rows.
   *
   * Two extra statements rather than one join, because a join would multiply
   * the asset row by renditions times attachments and every column of it would
   * have to be de-duplicated in TypeScript. The library is tens of rows.
   */
  private async hydrate(assets: readonly AssetRow[]): Promise<MediaAsset[]> {
    if (assets.length === 0) return [];

    const ids = assets.map((asset) => asset.id);

    const renditions = await this.prisma.$queryRaw<RenditionRow[]>`
      SELECT r.id, r.media_asset_id, lower(r.format::text) AS format, r.width, r.height,
             r.byte_size, r.content_hash
      FROM media_rendition r
      WHERE r.media_asset_id = ANY (${ids}::uuid[])
      ORDER BY r.width, r.format
    `;

    const attachments = await this.prisma.$queryRaw<AttachmentRow[]>`
      SELECT ma.id,
             ma.media_asset_id,
             ma.owner_type::text AS owner_type,
             coalesce(
               ma.therapist_id, ma.article_id, ma.testimonial_id, ma.space_id,
               ma.content_entry_id, ma.service_id
             ) AS owner_id,
             ma.position,
             ma.attached_at,
             ma.published_at,
             ma.focal_x,
             ma.focal_y,
             ma.crop_x,
             ma.crop_y,
             ma.crop_width,
             ma.crop_height,
             (${OWNER_IS_PUBLIC}) AS owner_is_public
      FROM media_attachment ma
      WHERE ma.media_asset_id = ANY (${ids}::uuid[]) AND ma.detached_at IS NULL
      ORDER BY ma.position, ma.id
    `;

    return assets.map((asset) => ({
      id: asset.id,
      altText: asset.alt_text,
      status: asset.status,
      width: asset.master_width,
      height: asset.master_height,
      byteSize: asset.master_byte_size,
      sourceContentType: asset.source_content_type,
      sourceByteSize: asset.source_byte_size,
      isPubliclyServed: asset.is_publicly_served,
      renditions: renditions
        .filter((rendition) => rendition.media_asset_id === asset.id)
        .map(toRendition),
      attachments: attachments
        .filter((attachment) => attachment.media_asset_id === asset.id)
        .map(toAttachment),
      createdAt: asset.created_at.toISOString(),
      archivedAt: asset.archived_at === null ? null : asset.archived_at.toISOString(),
      bytesPurgedAt: asset.bytes_purged_at === null ? null : asset.bytes_purged_at.toISOString(),
    }));
  }
}

const ASSET_COLUMNS = Prisma.sql`
  a.id,
  a.alt_text,
  a.status::text AS status,
  a.source_content_type,
  a.source_byte_size,
  a.master_byte_size,
  a.master_width,
  a.master_height,
  a.created_at,
  a.archived_at,
  a.bytes_purged_at,
  (${assetIsPubliclyServed('a')}) AS is_publicly_served
`;

type AssetRow = {
  id: string;
  /** Null exactly when erased. */
  alt_text: string | null;
  status: MediaAssetStatus;
  source_content_type: MediaContentType;
  source_byte_size: number;
  master_byte_size: number;
  master_width: number;
  master_height: number;
  created_at: Date;
  archived_at: Date | null;
  bytes_purged_at: Date | null;
  is_publicly_served: boolean;
};

type RenditionRow = {
  id: string;
  media_asset_id: string;
  format: MediaRenditionFormat;
  width: number;
  height: number;
  byte_size: number;
  content_hash: string;
};

type AttachmentRow = {
  id: string;
  media_asset_id: string;
  owner_type: MediaAttachmentOwner;
  owner_id: string | null;
  position: number;
  attached_at: Date;
  published_at: Date | null;
  focal_x: number;
  focal_y: number;
  crop_x: number | null;
  crop_y: number | null;
  crop_width: number | null;
  crop_height: number | null;
  owner_is_public: boolean;
};

function toRendition(row: RenditionRow): MediaRendition {
  return {
    id: row.id,
    path: `${PUBLIC_MEDIA_PATH_PREFIX}${row.id}`,
    format: row.format,
    width: row.width,
    height: row.height,
    byteSize: row.byte_size,
    contentHash: row.content_hash,
  };
}

function toAttachment(row: AttachmentRow): MediaAttachment {
  return {
    id: row.id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    position: row.position,
    attachedAt: row.attached_at.toISOString(),
    publishedAt: row.published_at === null ? null : row.published_at.toISOString(),
    ownerIsPublic: row.owner_is_public,
    framing: toFraming(row),
  };
}
