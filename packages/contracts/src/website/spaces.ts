import { z } from 'zod';
import { publicHeadingSchema, publicProseSchema } from './common';

/**
 * A public space as the people who write about it see it.
 *
 * Milestone 9.5, checkpoint A7.
 *
 * A PUBLIC SPACE IS EDITORIAL CONTENT. IT IS NOT AN OPERATIONAL ROOM, AND THE
 * TWO ARE NOT THE SAME THING WEARING DIFFERENT HATS. `room` is scheduling
 * configuration: it has a name a receptionist books against, an active/inactive
 * status, a service allow-list and appointments hanging off it. A public space
 * is a paragraph and some photographs about what a family walking through the
 * door will find. One is how the clinic runs; the other is what the clinic
 * says.
 *
 * THERE IS NO REFERENCE BETWEEN THEM, IN EITHER DIRECTION, AND THAT IS THE
 * DESIGN RATHER THAN AN OMISSION. No column on this shape names a room, no
 * column on a room names a space, and the two tables share no foreign key. The
 * consequences are the frozen A7 outcomes, and each of them is a property of
 * the SCHEMA rather than a promise made by a projection:
 *
 *   - Creating, renaming, restricting or deactivating a room cannot create,
 *     change, publish or unpublish a space, because there is no path from one
 *     row to the other.
 *   - No operational fact — a room id, a room status, a service restriction, an
 *     availability window, anything a diary knows — can reach a visitor through
 *     a space, because a space has never held one and cannot be joined to one.
 *   - A clinic that runs six rooms may publish two spaces, or one describing
 *     three of them, or a corridor and a garden that are not rooms at all.
 *
 * A nullable manager-set link between the two was considered and REJECTED for
 * this checkpoint: nothing in the accepted product asks a space "which room is
 * this?", and a column that answers an unasked question is the first half of
 * the coupling this checkpoint exists to prevent. REVISIT IF a decision arrives
 * that genuinely needs the join — a room-level page, or an operational report
 * about published spaces — at which point it is one nullable column and a
 * migration, and the non-publishing rule has to be stated then rather than
 * assumed now.
 *
 * THE COPY IS HELD TWICE, EXACTLY AS AN ARTICLE'S IS. `name`, `description`
 * and `displayOrder` are the working draft that `public_space.draft` may
 * rewrite at any time; the published columns behind them are what the website
 * reads, and only the manager-only publication act writes them. A receptionist
 * may therefore prepare a change to a live space and the page does not move
 * until a manager publishes it (DECISION_LOG, 2026-09-08 — Editorial authority
 * and operational authority are split).
 *
 * NO SLUG AND NO URL OF ITS OWN, for the reason a testimonial has none: a
 * space is an entry in a gallery, not a page. Adding an address later is
 * additive; taking one away after somebody has linked to it is not.
 *
 * WHAT IS DELIBERATELY ABSENT: no capacity, no equipment list, no floor, no
 * square metres, no opening hours, no accessibility claim and no clinical
 * statement about what happens in the space. Every one of those is either
 * operational data that belongs to configuration, or a claim the clinic's owner
 * has to make rather than a schema.
 */
export const spaceSchema = z.strictObject({
  id: z.uuid(),
  /** The working draft. NOT what a visitor is currently reading. */
  name: z.string(),
  description: z.string().nullable(),
  /**
   * Where this space sits in the published gallery, ascending.
   *
   * It is DRAFT state like the copy beside it, and it is split for the same
   * reason: reordering a live gallery is a change a visitor sees, so it takes
   * effect when a manager publishes and not when a receptionist saves.
   */
  displayOrder: z.int(),
  isPublic: z.boolean(),
  /**
   * The live gallery is showing something other than the draft above.
   *
   * True only while the space IS public, derived in the read rather than
   * stored, and carrying no diff — the same shape and the same reasoning as
   * `articleSchema.hasUnpublishedChanges`.
   */
  hasUnpublishedChanges: z.boolean(),
  firstPublishedAt: z.iso.datetime().nullable(),
  publicRevisedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type Space = z.infer<typeof spaceSchema>;

/**
 * Creating one ALWAYS creates a draft.
 *
 * There is deliberately no `isPublic` here, for the reason `createArticleRequest`
 * has none: creating is `public_space.draft`, which a receptionist holds, and
 * publishing is `public_space.publish`, which only a manager holds. A creation
 * request carrying a publication flag would let the lower authority perform the
 * higher act in one round trip.
 *
 * THERE IS NO `roomId` EITHER, and no field of any kind naming operational
 * configuration. See the note on `spaceSchema`.
 */
export const createSpaceRequestSchema = z.strictObject({
  name: publicHeadingSchema,
  description: publicProseSchema.nullable(),
  /**
   * Small on purpose. A clinic publishes a handful of spaces, and a gallery
   * position is a hint about order rather than an index into anything.
   */
  displayOrder: z.int().min(0).max(1000),
});

export type CreateSpaceRequest = z.infer<typeof createSpaceRequestSchema>;

/** Editing carries no publication flag either, for the same reason. */
export const updateSpaceRequestSchema = createSpaceRequestSchema;

export type UpdateSpaceRequest = z.infer<typeof updateSpaceRequestSchema>;

/**
 * Publishing and withdrawing, as one authority and two audited facts.
 *
 * `isPublic: true` IS ALSO THE APPROVAL OF A PENDING CHANGE, exactly as it is
 * for an article: publishing a space means "what the draft now says is what the
 * website says", whether the gallery entry was absent before or was showing an
 * earlier version.
 *
 * IT PUBLISHES COPY AND NEVER PHOTOGRAPHS. A space's images are
 * `MediaAttachment` rows and each carries its own manager publication under
 * `media.publish`; this act cannot publish one and does not try. What it does
 * control is whether any of them is REACHABLE, because an image on an
 * unpublished space is refused by the media serving predicate however published
 * its own attachment is — the same relationship an article has with its
 * illustrations.
 */
export const updateSpacePublicationRequestSchema = z.strictObject({
  isPublic: z.boolean(),
});

export type UpdateSpacePublicationRequest = z.infer<typeof updateSpacePublicationRequestSchema>;

export const spaceResponseSchema = z.strictObject({ space: spaceSchema });

export type SpaceResponse = z.infer<typeof spaceResponseSchema>;

export const spaceListResponseSchema = z.strictObject({ spaces: z.array(spaceSchema) });

export type SpaceListResponse = z.infer<typeof spaceListResponseSchema>;
