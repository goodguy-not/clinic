import { z } from 'zod';
import { duplicateCandidateSchema } from './common';
import { createChildRequestSchema } from './children';
import { createFamilyRequestSchema } from './families';

/**
 * A registration draft: what somebody typed, held by the server while they
 * decide whether the family they are registering already exists.
 *
 * A duplicate is only detectable after a submission, and a Route Handler cannot
 * render a page, so something has to hold the typed values across the
 * confirmation step. That something is a row in PostgreSQL, addressed by an
 * opaque token, rather than a cookie: a signed cookie gives integrity, not
 * confidentiality, and a family with an address, a note and several guardians
 * can exceed practical cookie size limits — failing intermittently, and only
 * for the largest records.
 *
 * The browser therefore holds a token and nothing else. It is sent authorised
 * personal data to render the comparison screen, which is the point of that
 * screen, but it is never asked to send it back: the confirmation carries
 * acknowledgement ids only, and the payload comes from the draft row.
 *
 * Drafts are transient workflow state, not domain history. They are deleted on
 * confirmation or discard, expire in ten minutes, are never audited, and carry
 * no append-only protection.
 *
 * Must stay identical to the `draft_purpose` PostgreSQL enum.
 */
export const DRAFT_PURPOSES = [
  'FAMILY_CREATE',
  'FAMILY_UPDATE',
  'CHILD_CREATE',
  'CHILD_UPDATE',
] as const;

export type DraftPurpose = (typeof DRAFT_PURPOSES)[number];

export const draftPurposeSchema = z.enum(DRAFT_PURPOSES);

/**
 * A resolved draft, for rendering the confirmation screen.
 *
 * The payload is returned in the shape it was submitted in, so the screen can
 * show what was typed without the browser having held it. Exactly one of
 * `family` and `child` is present, decided by `purpose`.
 *
 * The token is not echoed here. It arrives in a header and stays in an
 * HttpOnly cookie; putting it in a response body would be one more copy of a
 * bearer credential for no gain.
 */
export const registrationDraftResponseSchema = z.strictObject({
  purpose: draftPurposeSchema,
  expiresAt: z.iso.datetime(),
  targetFamilyId: z.uuid().nullable(),
  targetChildId: z.uuid().nullable(),
  family: createFamilyRequestSchema.nullable(),
  child: createChildRequestSchema.nullable(),
  candidates: z.array(duplicateCandidateSchema),
});

export type RegistrationDraftResponse = z.infer<typeof registrationDraftResponseSchema>;

/**
 * Confirming a draft: the ids of the candidates the member of staff looked at
 * and decided were somebody else.
 *
 * A tick and these ids, with no free-text reason. A mandatory reason on a
 * phone-call hot path gets filled with "…" and teaches people to click past the
 * question, which defeats the control. The acknowledgement is audited as its
 * own action instead, so "how often is this overridden?" is a countable
 * question at the pilot.
 *
 * The server does not trust this list on its own. It recomputes candidates
 * under the same locks the write takes and refuses again if anything blocking
 * is missing, so a duplicate created between the screen rendering and the
 * confirmation still stops the write.
 */
export const confirmDraftRequestSchema = z.strictObject({
  acknowledgedDuplicateIds: z.array(z.uuid()).min(1),
});

export type ConfirmDraftRequest = z.infer<typeof confirmDraftRequestSchema>;
