import { z } from 'zod';
import {
  MEDIA_ACCEPTED_CONTENT_TYPES,
  MEDIA_RENDITION_FORMATS,
  mediaAltTextSchema,
  mediaFramingSchema,
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
 * or not, so an image on them is visible only while that record is. A
 * clinic-space photograph has no such record to hang off, so it is visible
 * exactly while its own attachment is published, and manager authority over
 * that attachment is the whole of the control.
 *
 * IT IS A SLOT, NOT A PRODUCT SURFACE, AND THE DIFFERENCE IS DELIBERATE. What
 * Milestone 9.5 settles is that a photograph of the clinic's own rooms can be
 * uploaded, attached, published by a manager and anonymously served — the same
 * four gates as everything else, minus the owner gate that has no row to read.
 * What it does NOT settle is where such photographs appear, in what order,
 * under what heading, how many there may be, or whether they belong to a page
 * of their own: NO PUBLIC PROJECTION IN THIS PRODUCT RETURNS A `CLINIC_SPACE`
 * ATTACHMENT, before checkpoint A7 or after it.
 *
 * `PUBLIC_SPACE` IS THE FIFTH VALUE, ADDED IN CHECKPOINT A7, AND IT IS THE NEW
 * DECISION THIS COMMENT SAID A FIFTH WOULD HAVE TO BE. It names a `public_space`
 * row — an editorial description of part of the building that a receptionist
 * drafts and a manager publishes — so it behaves like the first three and not
 * like `CLINIC_SPACE`: an owner id is REQUIRED, and the image is visible only
 * while that space is itself published.
 *
 * THE TWO ARE NOT DUPLICATES, AND KEEPING BOTH IS DELIBERATE. `CLINIC_SPACE`
 * remains exactly what A5 froze — an ownerless slot that no public projection
 * reads — and the web tier uses it as the parking place for a photograph
 * somebody has uploaded and framed but not yet placed anywhere. Redefining it
 * to require an owner would have turned that drafting sandbox into a live
 * public-gallery target, which is precisely the coupling A7 exists to prevent.
 * REVISIT WHEN the web tier gains a first-class "prepared but unplaced" concept
 * of its own: `CLINIC_SPACE` is then vocabulary with nothing behind it and
 * should be retired in a reviewed migration.
 */
export const MEDIA_ATTACHMENT_OWNERS = [
  'THERAPIST_PROFILE',
  'PUBLIC_ARTICLE',
  'PUBLIC_TESTIMONIAL',
  'CLINIC_SPACE',
  /** Milestone 9.5, checkpoint A7. A `public_space` row; an owner id is required. */
  'PUBLIC_SPACE',
  /**
   * Milestone 9.5, checkpoint A8. A `clinic_content_entry` row — one of the
   * fixed editorial slots the home and about pages are written into; an owner
   * id is required.
   *
   * IT BEHAVES LIKE `PUBLIC_SPACE` AND NOT LIKE `CLINIC_SPACE`, even though the
   * clinic profile has no publication act of its own. The gate is the ENTRY
   * ITSELF HAVING BEEN WRITTEN: an entry with no heading appears on no page, so
   * its photograph is unreachable too. That keeps one rule — "an empty slot
   * says nothing" — rather than a projection rule and a separate media rule
   * that could drift.
   */
  'CLINIC_CONTENT_ENTRY',
  /**
   * Milestone 9.5, checkpoint A8. The clinic's own Open Graph photograph: the
   * picture a link to any page of this site unfurls into on a messaging
   * application.
   *
   * OWNERLESS, LIKE `CLINIC_SPACE`, AND FOR THE SAME REASON: it hangs off
   * `clinic_public_profile`, which is a single row that is always live —
   * editing it IS publishing (Milestone 9, checkpoint A2). Manager publication
   * of the attachment is therefore the whole of the control.
   *
   * IT IS A PHOTOGRAPH AND NEVER THE BRAND MARK. The accepted Vala SVG logos
   * are static web-tier assets that a human reviewed, SVG is refused by this
   * uploader by design, and nothing here makes a logo staff-manageable.
   */
  'CLINIC_OPEN_GRAPH',
] as const;

export type MediaAttachmentOwner = (typeof MEDIA_ATTACHMENT_OWNERS)[number];

/**
 * THE OWNER TYPES THAT NAME NO ROW, STATED ONCE SO BOTH TIERS AGREE.
 *
 * Milestone 9.5, checkpoint A8. Until A8 there was exactly one of these and
 * every caller wrote `!== 'CLINIC_SPACE'`; a second one turned that idiom into
 * a rule with two places to forget it. An attachment of one of these types
 * carries no owner id, and one of any other type must.
 */
export const MEDIA_OWNERLESS_ATTACHMENT_OWNERS = ['CLINIC_SPACE', 'CLINIC_OPEN_GRAPH'] as const;

export type MediaOwnerlessAttachmentOwner = (typeof MEDIA_OWNERLESS_ATTACHMENT_OWNERS)[number];

/** Whether an attachment of this owner type names a row, or nothing. */
export function isOwnerlessMediaAttachment(
  ownerType: MediaAttachmentOwner,
): ownerType is MediaOwnerlessAttachmentOwner {
  return (MEDIA_OWNERLESS_ATTACHMENT_OWNERS as readonly string[]).includes(ownerType);
}

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
  /**
   * The article, therapist, testimonial, public space or clinic content entry.
   * Null exactly for the ownerless types — see
   * `MEDIA_OWNERLESS_ATTACHMENT_OWNERS`.
   */
  ownerId: z.uuid().nullable(),
  /** Ascending, so a gallery has one order rather than whatever PostgreSQL returns. */
  position: z.int().min(0),
  attachedAt: z.iso.datetime(),
  publishedAt: z.iso.datetime().nullable(),
  /**
   * Whether the record this hangs off is itself public right now. Always true for
   * the ownerless types, which have no record to read; for `PUBLIC_SPACE` it is
   * that space's own publication, and for `CLINIC_CONTENT_ENTRY` it is whether
   * that editorial slot has been written at all (Milestone 9.5, checkpoint A8).
   */
  ownerIsPublic: z.boolean(),
  /**
   * How this use of the photograph is framed. Always present; an unframed
   * attachment carries `DEFAULT_MEDIA_FRAMING`.
   *
   * IT IS ON THE ATTACHMENT AND NOT ON THE ASSET, so the same master can be a
   * wide banner in one place and a square tile in another. See
   * `mediaFramingSchema` for why nothing here is ever encoded into the pixels.
   */
  framing: mediaFramingSchema,
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
  /**
   * When the stored bytes were physically erased, and NULL for as long as they
   * are still held — which is every asset today.
   *
   * NOTHING IN THIS PRODUCT SETS IT YET, AND THAT IS THE POINT. The retention
   * policy — how long the clinic keeps a photograph nobody publishes any more,
   * and what starts the clock — is an owner decision nobody has taken, so there
   * is no schedule, no duration, no route and no permission for erasure
   * anywhere in this checkpoint.
   *
   * WHAT THIS FIELD BUYS IS THAT THE DECISION STAYS CHEAP. When it is taken, an
   * erasure is an UPDATE that sets this and clears the storage keys, plus an
   * unlink of the files — with no change to the media model, no new table and
   * no rewriting of what is already stored. The alternative, discovered later,
   * is a migration that makes a NOT NULL column nullable on a live table full
   * of a clinic's photographs.
   *
   * IT IS THE `website_request.purgedAt` PATTERN, DELIBERATELY. The row that
   * remains says a photograph existed and where it was used; the bytes it
   * described are gone. `audit_log` keeps the acts and never held the content.
   */
  bytesPurgedAt: z.iso.datetime().nullable(),
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

/**
 * Re-framing. The narrowest write in the subsystem: no byte moves, no rendition
 * is re-derived, and the master is untouched.
 *
 * BEHIND `media.attach` AND REFUSED WHILE THE ATTACHMENT IS PUBLISHED, which is
 * exactly the rule detaching follows and for exactly the same reason: the
 * weaker authority must not be able to change what is on a live page. A manager
 * re-framing a published image unpublishes, re-frames and republishes — three
 * audited acts rather than one silent one.
 *
 * REVISIT TRIGGER: if managers find that sequence painful in practice, the
 * answer is a second route under `media.publish` that re-frames in place, not a
 * relaxation of this one.
 */
export const updateMediaFramingRequestSchema = mediaFramingSchema;

export type UpdateMediaFramingRequest = z.infer<typeof updateMediaFramingRequestSchema>;

/** Archiving and restoring. Also the manager's, and also in both directions. */
export const updateMediaArchiveRequestSchema = z.strictObject({
  archived: z.boolean(),
});

export type UpdateMediaArchiveRequest = z.infer<typeof updateMediaArchiveRequestSchema>;
