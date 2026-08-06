import { z } from 'zod';
import { isoDateSchema } from '../dates';
import {
  addressSchema,
  fileNumberSchema,
  guardianRelationshipSchema,
  iranLandlineSchema,
  iranMobileSchema,
  noteSchema,
  noticeCodeSchema,
  personNameSchema,
  recordStatusSchema,
  relationshipNoteSchema,
} from './common';

/**
 * A family is the clinic's account unit: one balance, one set of contacts, and
 * the children treated under it (PROJECT_SPEC.md 5).
 *
 * It carries the surname used as the account's label and nothing else
 * identifying. Every phone number belongs to a named guardian, because "whose
 * number is this?" is the question a receptionist actually has when the phone
 * rings, and a pair of unattributed columns cannot answer it.
 */

/** A guardian as stored: a contact, not a subject of care. */
export const guardianSchema = z.strictObject({
  id: z.uuid(),
  fullName: z.string(),
  relationship: guardianRelationshipSchema,
  relationshipNote: z.string().nullable(),
  mobile: z.string().nullable(),
  landline: z.string().nullable(),
  isPrimaryContact: z.boolean(),
});

export type Guardian = z.infer<typeof guardianSchema>;

/**
 * One guardian as submitted.
 *
 * Both refinements mirror database constraints rather than inventing rules:
 * `guardian_relationship_note_chk` and `guardian_primary_needs_contact_chk`.
 * Catching them here turns a constraint failure that would surface as an
 * internal error into an ordinary validation message.
 */
export const createGuardianRequestSchema = z
  .strictObject({
    fullName: personNameSchema,
    relationship: guardianRelationshipSchema,
    relationshipNote: relationshipNoteSchema.nullable(),
    mobile: iranMobileSchema.nullable(),
    landline: iranLandlineSchema.nullable(),
    isPrimaryContact: z.boolean(),
  })
  .refine(
    (value) => (value.relationship === 'OTHER') === (value.relationshipNote !== null),
    'a relationship of OTHER requires a note, and any other relationship must not carry one',
  );

export type CreateGuardianRequest = z.infer<typeof createGuardianRequestSchema>;

export const familySchema = z.strictObject({
  id: z.uuid(),
  familyName: z.string(),
  address: z.string().nullable(),
  note: z.string().nullable(),
  status: recordStatusSchema,
  deactivatedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type Family = z.infer<typeof familySchema>;

/** A child as it appears inside a family row or a search result. */
export const childSummarySchema = z.strictObject({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  fileNumber: fileNumberSchema,
  birthDate: isoDateSchema,
  status: recordStatusSchema,
});

export type ChildSummary = z.infer<typeof childSummarySchema>;

/** The primary contact, as shown beside a family in a list. */
export const guardianSummarySchema = z.strictObject({
  fullName: z.string(),
  relationship: guardianRelationshipSchema,
  mobile: z.string().nullable(),
  landline: z.string().nullable(),
});

export type GuardianSummary = z.infer<typeof guardianSummarySchema>;

/**
 * One row of a search result.
 *
 * Denormalised on purpose: a receptionist scanning results needs the contact
 * name, the number and the children's names at once, and fetching them per row
 * would be an N+1 across an HTTP boundary.
 *
 * `awaitingFirstChild` is stated rather than inferred from an empty array. A
 * family registered a moment ago and not yet given a child is a normal,
 * complete record — not a broken one — and saying so plainly is what keeps the
 * list from looking like it has failed.
 */
export const familySummarySchema = z.strictObject({
  id: z.uuid(),
  familyName: z.string(),
  status: recordStatusSchema,
  deactivatedAt: z.iso.datetime().nullable(),
  primaryGuardian: guardianSummarySchema.nullable(),
  guardianCount: z.number().int().nonnegative(),
  children: z.array(childSummarySchema),
  childCount: z.number().int().nonnegative(),
  awaitingFirstChild: z.boolean(),
  createdAt: z.iso.datetime(),
});

export type FamilySummary = z.infer<typeof familySummarySchema>;

/**
 * Search input.
 *
 * A JSON body, never a query string. The term is a guardian's name, a child's
 * name, a mobile number or a file number — personal data, which must not reach
 * a browser history entry, a `Referer` header or an access log. That is the
 * whole reason this is a POST that reads.
 *
 * `includeInactive` is a real boolean rather than a coerced string for the same
 * reason: it arrives in a body, so there is nothing to coerce.
 *
 * An absent `q` is not an error. It means "show me what was registered
 * recently", which is the path taken straight after creating a family.
 */
export const familySearchRequestSchema = z.strictObject({
  q: z.string().trim().min(2).max(60).optional(),
  includeInactive: z.boolean().optional(),
});

export type FamilySearchRequest = z.infer<typeof familySearchRequestSchema>;

/**
 * `truncated` says more matches exist than were returned, so the interface can
 * ask for a narrower search instead of implying it has shown everything.
 */
export const familyListResponseSchema = z.strictObject({
  families: z.array(familySummarySchema),
  truncated: z.boolean(),
});

export type FamilyListResponse = z.infer<typeof familyListResponseSchema>;

/**
 * A family and everything under it.
 *
 * Guardians are replaced as a set rather than edited individually, so a request
 * carries the complete list and the server writes exactly that. The same shape
 * therefore serves creation and update.
 */
const familyRequestFields = z.strictObject({
  familyName: personNameSchema,
  address: addressSchema.nullable(),
  note: noteSchema.nullable(),
  guardians: z.array(createGuardianRequestSchema).min(1).max(6),
});

/**
 * Creating a family.
 *
 * Both refinements mirror what the database enforces — a partial unique index
 * for "at most one primary" and `guardian_primary_needs_contact_chk` for "the
 * primary is reachable" — so a mistake surfaces as an ordinary validation
 * failure instead of a constraint error the interface cannot explain.
 *
 * Mobile is preferred but not required. A family reachable only on a landline
 * is a real family, and refusing it would refuse a patient.
 *
 * No child is included. Registration is two steps — the family, then the first
 * child — because one request carrying both would produce two duplicate
 * verdicts in one response, and the confirmation screen would have to reason
 * about both at once. The interface keeps it one continuous flow.
 *
 * There is no acknowledgement field here either. An override is only reachable
 * through a confirmation, so it is always tied to candidates the server
 * recorded and a member of staff actually saw.
 */
export const createFamilyRequestSchema = familyRequestFields
  .refine(
    (value) => value.guardians.filter((guardian) => guardian.isPrimaryContact).length === 1,
    'exactly one guardian must be the primary contact',
  )
  .refine(
    (value) =>
      value.guardians
        .filter((guardian) => guardian.isPrimaryContact)
        .every((guardian) => guardian.mobile !== null || guardian.landline !== null),
    'the primary contact must have a mobile or a landline',
  );

export type CreateFamilyRequest = z.infer<typeof createFamilyRequestSchema>;

/** Identical to creation: guardians are replaced as a set, so the shapes match. */
export const updateFamilyRequestSchema = createFamilyRequestSchema;

export type UpdateFamilyRequest = z.infer<typeof updateFamilyRequestSchema>;

export const familyDetailResponseSchema = z.strictObject({
  family: familySchema,
  guardians: z.array(guardianSchema),
  children: z.array(childSummarySchema),
});

export type FamilyDetailResponse = z.infer<typeof familyDetailResponseSchema>;

/**
 * The response to a write that succeeded.
 *
 * `nonBlockingWarnings` is the visible half of soft duplicate detection: the
 * write went ahead, because similarity alone is never a refusal, and the
 * interface still has to say something. It carries fixed codes only — never a
 * candidate's name or id — which is what lets the redirect that follows put one
 * of them in a `?notice=` parameter without putting personal data in a URL.
 */
export const familyWriteResponseSchema = familyDetailResponseSchema.extend({
  nonBlockingWarnings: z.array(noticeCodeSchema),
});

export type FamilyWriteResponse = z.infer<typeof familyWriteResponseSchema>;
