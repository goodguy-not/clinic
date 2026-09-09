import { z } from 'zod';
import { publicHeadingSchema, publicProseSchema, publicSlugSchema } from './common';

/**
 * The EDITORIAL view of the two catalog records that also have a public face.
 *
 * Milestone 9.5, checkpoint A6. A2 gave articles a draft the front desk may
 * write and a published copy only a manager may move, and froze the rule that
 * the permission which publishes is never the permission which writes. These
 * shapes are that rule applied to the two records A2 left out: a service's
 * public description, and a colleague's public title and biography.
 *
 * THEY ARE SEPARATE SHAPES FROM `serviceSchema` AND FROM THE PERSONNEL READ,
 * FOR THE REASON `therapistPublicProfileSchema` IS. `serviceSchema` carries the
 * durations, the status and the visibility flag — operational configuration
 * PROJECT_SPEC.md 4 keeps with the manager — and folding an editorial surface
 * into it would hand a drafting role a window onto all of it. What a person
 * drafting copy needs is the copy, what the website currently says, and enough
 * context to know whose page they are on.
 *
 * EVERY SHAPE HERE CARRIES BOTH SIDES. The draft is what the editor is working
 * on; the `published*` field is what a visitor sees right now; and
 * `hasUnpublishedChanges` is the signal that the two have come apart and a
 * manager has something to decide. A surface that showed only one of them could
 * not tell an author whether their change had gone live.
 */

/**
 * A service's public copy, as the person maintaining it sees it.
 *
 * `name`, `publicSlug` and `isPublic` ARE PRESENT AND ARE NOT WRITABLE HERE.
 * They are on the operational form under `service.update`, and they appear in
 * this shape only so an editor knows which service they are describing, at what
 * address, and whether anybody can currently read it. The one field this
 * surface writes is `description`.
 *
 * THE SERVICE NAME IS NOT DRAFTABLE AND DELIBERATELY HAS NO PUBLISHED COPY. A
 * service's name IS its public name (DECISION_LOG, 2026-08-21), so a second
 * stored version of it could let the site advertise something the clinic had
 * stopped offering. Renaming a service therefore still changes the public page
 * at once, under `service.update`, and a drafting role cannot do it at all.
 */
export const servicePublicCopySchema = z.strictObject({
  serviceId: z.uuid(),
  name: z.string(),
  publicSlug: publicSlugSchema.nullable(),
  isPublic: z.boolean(),
  /** The working draft. Writable under `service.draft_public_copy`. */
  description: z.string().nullable(),
  /** What the website says. Written only by the manager publication act. */
  publishedDescription: z.string().nullable(),
  /** True when the draft and the published copy differ on a reachable service. */
  hasUnpublishedChanges: z.boolean(),
  publicFirstPublishedAt: z.iso.datetime().nullable(),
  publicRevisedAt: z.iso.datetime().nullable(),
});

export type ServicePublicCopy = z.infer<typeof servicePublicCopySchema>;

/**
 * The one field a drafting role may write on a service.
 *
 * Null clears the prepared description, which is a real editorial act: it means
 * "this service should be listed with no description", and publishing that is a
 * separate decision like any other.
 *
 * The prose rule is A2's rather than Milestone 2's: no markup, because this
 * text is rendered to strangers and the answer this product gives to stored
 * cross-site scripting is that there is nothing to sanitise. The column's own
 * CHECK is older and does not say so, which is why the narrower rule is stated
 * on the surface that will carry most of the writing.
 */
export const updateServicePublicCopyRequestSchema = z.strictObject({
  description: publicProseSchema.max(2000).nullable(),
});

export type UpdateServicePublicCopyRequest = z.infer<typeof updateServicePublicCopyRequestSchema>;

/**
 * The manager act: what the draft now says is what the website says.
 *
 * `isPublished: false` WITHDRAWS THE PUBLISHED DESCRIPTION AND LEAVES THE
 * SERVICE LISTED. It is the proportionate remedy for copy that turned out to be
 * wrong — the alternative being to take an entire service off the website
 * because one sentence is — and it is the same direction the article
 * publication route already has. It does not touch `isPublic`: removing the
 * service from the site is `service.update`, where that flag lives.
 */
export const updateServicePublicCopyPublicationRequestSchema = z.strictObject({
  isPublished: z.boolean(),
});

export type UpdateServicePublicCopyPublicationRequest = z.infer<
  typeof updateServicePublicCopyPublicationRequestSchema
>;

export const servicePublicCopyResponseSchema = z.strictObject({ copy: servicePublicCopySchema });

export type ServicePublicCopyResponse = z.infer<typeof servicePublicCopyResponseSchema>;

export const servicePublicCopyListResponseSchema = z.strictObject({
  copies: z.array(servicePublicCopySchema),
});

export type ServicePublicCopyListResponse = z.infer<typeof servicePublicCopyListResponseSchema>;

/**
 * A therapist's public copy, as a drafting role sees it — WHICH IS LESS THAN A
 * MANAGER SEES.
 *
 * THE THREE PROSE FIELDS ARE DRAFTABLE: the public display name, the public
 * title and the biography. That is the whole of the routine public copy about a
 * colleague, and preparing any of it publishes nobody — the drafts are not what
 * a visitor reads, and only the manager opt-in copies them across.
 *
 * WHAT IS ABSENT IS THE PUBLICATION DECISION AND EVERYTHING OPERATIONAL. There
 * is no slug here, no photograph path, no display order, no personnel field and
 * no visibility flag — not filtered out, ABSENT. Deciding that a named human
 * being appears on a public website, and at what address, remains
 * `therapist.publish_profile`, which A1 separated so it could be granted and
 * revoked on its own.
 */
export const therapistProfileCopySchema = z.strictObject({
  therapistId: z.uuid(),
  /** The working draft. Writable under `therapist.draft_public_profile`. */
  displayName: z.string().nullable(),
  publishedDisplayName: z.string().nullable(),
  /** The working draft. Writable under `therapist.draft_public_profile`. */
  title: z.string().nullable(),
  publishedTitle: z.string().nullable(),
  /** The working draft. Writable under `therapist.draft_public_profile`. */
  bio: z.string().nullable(),
  publishedBio: z.string().nullable(),
  isPublic: z.boolean(),
  hasUnpublishedChanges: z.boolean(),
});

export type TherapistProfileCopy = z.infer<typeof therapistProfileCopySchema>;

/**
 * The three fields a drafting role may write on a colleague's profile.
 *
 * All three are required and nullable rather than optional, so a request states
 * the whole of the copy it is replacing and a half-sent form cannot leave a
 * paragraph nobody meant to keep.
 *
 * `displayName` IS DRAFTABLE, AND CLEARING IT IS NOT A WAY TO TAKE ANYBODY OFF
 * THE WEBSITE. The published name is a different column; the live page keeps
 * saying it until a manager publishes, and a publication that would leave that
 * page nameless is refused by `therapist_public_profile_chk` as
 * `THERAPIST_PUBLIC_PROFILE_INCOMPLETE`. Drafting a name is preparing copy;
 * deciding somebody appears under it is the opt-in, and stays the manager's.
 */
export const updateTherapistProfileCopyRequestSchema = z.strictObject({
  displayName: publicHeadingSchema.max(120).nullable(),
  title: publicHeadingSchema.max(120).nullable(),
  bio: publicProseSchema.max(4000).nullable(),
});

export type UpdateTherapistProfileCopyRequest = z.infer<
  typeof updateTherapistProfileCopyRequestSchema
>;

export const therapistProfileCopyResponseSchema = z.strictObject({
  copy: therapistProfileCopySchema,
});

export type TherapistProfileCopyResponse = z.infer<typeof therapistProfileCopyResponseSchema>;

export const therapistProfileCopyListResponseSchema = z.strictObject({
  copies: z.array(therapistProfileCopySchema),
});

export type TherapistProfileCopyListResponse = z.infer<
  typeof therapistProfileCopyListResponseSchema
>;
