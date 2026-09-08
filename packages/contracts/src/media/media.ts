import { z } from 'zod';
import {
  MEDIA_ACCEPTED_CONTENT_TYPES,
  MEDIA_RENDITION_FORMATS,
  mediaAltTextSchema,
} from './common';
import { publicMediaPathSchema } from '../website/common';

/**
 * The STAFF view of the media library.
 *
 * Milestone 9.5, checkpoint A5. Everything here is behind a named permission
 * and none of it is reachable by a visitor. It is deliberately longer than
 * `publicImageSchema`, because the person deciding whether a photograph may go
 * on the internet needs to see the things a visitor must never be told: whether
 * anything is attached to it at all, whether that attachment has been
 * published, whether the owner it hangs off is itself live, and whether the
 * asset has been archived out of circulation.
 */

/**
 * WHAT A PHOTOGRAPH CAN BE ATTACHED TO. Four kinds, and the list is closed.
 *
 * These are the four places PROJECT_SPEC.md 11's public website has a
 * photograph: a colleague's portrait, an article's illustration, the
 * photographed note a family wrote, and the clinic's own rooms. A fifth would
 * be a new decision about what the clinic publishes, not a new value in an
 * enum, which is why this is an enum rather than free text.
 *
 * `CLINIC_SPACE` IS THE ONE WITH NO OWNER ROW, and the difference matters for
 * publication. The other three hang off a record that is itself either public
 * or not, so an image on them is visible only while that record is; the clinic
 * profile is a single row that is always live — editing it IS publishing
 * (Milestone 9, checkpoint A2) — so a clinic-space photograph is visible
 * exactly while its own attachment is published, and manager authority over
 * that attachment is the whole of the control.
 */
export const MEDIA_ATTACHMENT_OWNERS = [
  'THERAPIST_PROFILE',
  'PUBLIC_ARTICLE',
  'PUBLIC_TESTIMONIAL',
  'CLINIC_SPACE',
] as const;

export type MediaAttachmentOwner = (typeof MEDIA_ATTACHMENT_OWNERS)[number];

/**
 * `ACTIVE` and `ARCHIVED`, and archiving is NOT deletion.
 *
 * An archived asset stops being servable immediately and everywhere, keeps its
 * row, its renditions and its trail, and can be restored. NOTHING IN THIS
 * CHECKPOINT REMOVES BYTES FROM DISK: how long the clinic keeps a photograph
 * nobody publishes any more is a retention decision the owner has not taken,
 * and a product that guessed either way — erasing on archive, or promising to
 * keep forever — would be pre-empting it.
 */
export const MEDIA_ASSET_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;

export type MediaAssetStatus = (typeof MEDIA_ASSET_STATUSES)[number];

/** One derived, servable copy, as a member of staff sees it. */
export const mediaRenditionSchema = z.strictObject({
  id: z.uuid(),
  path: publicMediaPathSchema,
  format: z.enum(MEDIA_RENDITION_FORMATS),
  width: z.int().positive(),
  height: z.int().positive(),
  byteSize: z.int().positive(),
  /**
   * The SHA-256 of exactly these bytes, and the value served as the `ETag`.
   *
   * It is content IDENTITY: two renditions with the same hash are the same
   * picture, and a rendition whose hash changed is a different picture that
   * cannot be confused with the one a cache already holds. It is not a
   * revocation mechanism — see `PUBLIC_MEDIA_REVOCATION_WINDOW_SECONDS`.
   */
  contentHash: z.string(),
});

export type MediaRendition = z.infer<typeof mediaRenditionSchema>;

/**
 * One place this photograph has been put, and how far along it is.
 *
 * `publishedAt` IS THE MANAGER'S DECISION AND `ownerIsPublic` IS THE WORLD'S
 * STATE. Both must be true for a visitor to see anything, and separating them
 * is what lets a receptionist prepare a page nobody can see yet: attaching is
 * drafting, publishing is a manager act, and an image attached to an
 * unpublished article stays invisible even after a manager publishes the
 * attachment.
 */
export const mediaAttachmentSchema = z.strictObject({
  id: z.uuid(),
  ownerType: z.enum(MEDIA_ATTACHMENT_OWNERS),
  /** The article, therapist or testimonial. Null exactly for `CLINIC_SPACE`. */
  ownerId: z.uuid().nullable(),
  /** Ascending, so a gallery has one order rather than whatever PostgreSQL returns. */
  position: z.int().min(0),
  attachedAt: z.iso.datetime(),
  publishedAt: z.iso.datetime().nullable(),
  /** Whether the record this hangs off is itself public right now. Always true for `CLINIC_SPACE`. */
  ownerIsPublic: z.boolean(),
});

export type MediaAttachment = z.infer<typeof mediaAttachmentSchema>;

/**
 * A photograph in the library.
 *
 * THERE IS NO FIELD HERE FOR THE UPLOADED FILE. `sourceContentType` and
 * `sourceByteSize` describe what arrived and are kept because a colleague
 * asking "did that upload work?" needs them; the bytes themselves were never
 * written anywhere. `width`, `height` and `byteSize` describe the MASTER — the
 * re-encoded, re-oriented, metadata-free copy the clinic keeps — and the master
 * is not servable either: it has no path, and the serving route can only ever
 * name a rendition.
 *
 * `isPubliclyServed` IS THE ONE DERIVED FIELD, and it is the answer to the only
 * question that actually matters on this screen: can a stranger fetch this
 * right now? It is computed from the same predicate the serving route applies,
 * in the same statement, so the library cannot say "not public" about something
 * the origin is still handing out.
 */
export const mediaAssetSchema = z.strictObject({
  id: z.uuid(),
  altText: z.string(),
  status: z.enum(MEDIA_ASSET_STATUSES),
  width: z.int().positive(),
  height: z.int().positive(),
  byteSize: z.int().positive(),
  sourceContentType: z.enum(MEDIA_ACCEPTED_CONTENT_TYPES),
  sourceByteSize: z.int().positive(),
  isPubliclyServed: z.boolean(),
  renditions: z.array(mediaRenditionSchema),
  attachments: z.array(mediaAttachmentSchema),
  createdAt: z.iso.datetime(),
  archivedAt: z.iso.datetime().nullable(),
});

export type MediaAsset = z.infer<typeof mediaAssetSchema>;

/**
 * The non-file half of an upload.
 *
 * The request is `multipart/form-data` — one file part named `file`, and these
 * text parts beside it. Multipart rather than JSON so the byte cap can be
 * enforced while the body is still arriving, instead of after a base64 payload
 * a third larger than the file has already been buffered and parsed.
 */
export const mediaUploadFieldsSchema = z.strictObject({
  altText: mediaAltTextSchema,
});

export type MediaUploadFields = z.infer<typeof mediaUploadFieldsSchema>;

export const mediaAssetResponseSchema = z.strictObject({ media: mediaAssetSchema });

export type MediaAssetResponse = z.infer<typeof mediaAssetResponseSchema>;

export const mediaAssetListResponseSchema = z.strictObject({ media: z.array(mediaAssetSchema) });

export type MediaAssetListResponse = z.infer<typeof mediaAssetListResponseSchema>;

/**
 * Putting a photograph somewhere. ALWAYS AS A DRAFT.
 *
 * There is no `isPublished` on this request, and that absence is the authority
 * boundary: the permission that attaches is not the permission that publishes,
 * exactly as `article.draft` is not `article.publish`. A caller who could ask
 * for both in one request would be a caller who only needs the weaker one.
 */
export const createMediaAttachmentRequestSchema = z.strictObject({
  ownerType: z.enum(MEDIA_ATTACHMENT_OWNERS),
  ownerId: z.uuid().nullable(),
  position: z.int().min(0).max(999).default(0),
});

export type CreateMediaAttachmentRequest = z.infer<typeof createMediaAttachmentRequestSchema>;

/** The manager act. In both directions, because taking something down is the same authority. */
export const updateMediaPublicationRequestSchema = z.strictObject({
  isPublished: z.boolean(),
});

export type UpdateMediaPublicationRequest = z.infer<typeof updateMediaPublicationRequestSchema>;

/** Archiving and restoring. Also the manager's, and also in both directions. */
export const updateMediaArchiveRequestSchema = z.strictObject({
  archived: z.boolean(),
});

export type UpdateMediaArchiveRequest = z.infer<typeof updateMediaArchiveRequestSchema>;
