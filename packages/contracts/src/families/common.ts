import { z } from 'zod';

/**
 * Shared primitives for families, guardians and children.
 *
 * These describe people the clinic treats and the people who bring them, so
 * two rules govern everything here.
 *
 * The first is that stored values are never rewritten. Outer whitespace is
 * trimmed and nothing else: no Persian yeh/kaf folding, no internal-whitespace
 * collapsing, no fuzzy matching. Folding belongs to a derived search key, which
 * PostgreSQL computes and nothing in this package ever sees.
 *
 * The second is that this package stays declarative. Input tolerance — Persian
 * digits, `+98`, spaces and hyphens in a phone number, a Jalali date — is the
 * web tier's job and happens before anything here is asked to validate. What
 * these schemas describe is the canonical form that reaches PostgreSQL.
 */

/**
 * Lifecycle of a family or child record.
 *
 * Deliberately separate from `catalog_status` despite having the same two
 * values. A family is not clinic reference data, and the two lifecycles are
 * likely to diverge: a discharged family may one day need a state a treatment
 * room never will.
 *
 * There is no `DELETED` and no `ARCHIVED`. Records with history are deactivated
 * (PROJECT_SPEC.md 5), the database refuses a `DELETE` outright, and "archived"
 * means inactive until some report treats the two differently.
 *
 * Must stay identical to the `record_status` PostgreSQL enum; an integration
 * test asserts the two lists match.
 */
export const RECORD_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

export type RecordStatus = (typeof RECORD_STATUSES)[number];

export const recordStatusSchema = z.enum(RECORD_STATUSES);

/** Activation and deactivation share one request shape across both entities. */
export const updateRecordStatusRequestSchema = z.strictObject({
  status: recordStatusSchema,
});

export type UpdateRecordStatusRequest = z.infer<typeof updateRecordStatusRequestSchema>;

/**
 * How a guardian is related to the children in the family.
 *
 * A closed list rather than free text, so a report can group by it and so the
 * receptionist answering the phone knows who they are speaking to. `OTHER`
 * carries a required short note, which keeps it from becoming a black hole —
 * the same shape the tariff contracts use for `FREE` and its reason.
 *
 * This is deliberately not a custody or legal-guardianship model. It records
 * who to call. `GUARDIAN` means a caring adult who is not a parent or
 * grandparent, and implies nothing about legal status.
 *
 * Must stay identical to the `guardian_relationship` PostgreSQL enum.
 */
export const GUARDIAN_RELATIONSHIPS = [
  'MOTHER',
  'FATHER',
  'GRANDMOTHER',
  'GRANDFATHER',
  'GUARDIAN',
  'OTHER',
] as const;

export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number];

export const guardianRelationshipSchema = z.enum(GUARDIAN_RELATIONSHIPS);

/**
 * Recorded sex of a child.
 *
 * `UNSPECIFIED` is a real value and the default, not a missing one: a phone-call
 * registration should never stall on it, and a column that can be absent would
 * make "not asked yet" and "declined to say" indistinguishable from a bug.
 *
 * Must stay identical to the `child_sex` PostgreSQL enum.
 */
export const CHILD_SEXES = ['FEMALE', 'MALE', 'UNSPECIFIED'] as const;

export type ChildSex = (typeof CHILD_SEXES)[number];

export const childSexSchema = z.enum(CHILD_SEXES);

/**
 * A person's name, or one part of one.
 *
 * `.trim()` runs before the length checks, so the value reaching the database
 * is already canonical — which is what makes `= btrim(...)`, asserted by a CHECK
 * on every one of these columns, hold.
 *
 * Names are never unique and never near-matched here. Two children may share a
 * name, and refusing the second would be refusing a person.
 */
export const personNameSchema = z.string().trim().min(1).max(120);

/** A postal address or directions. Optional everywhere it appears. */
export const addressSchema = z.string().trim().min(1).max(500);

/**
 * A non-clinical note.
 *
 * Clinical records are excluded from the product (PROJECT_SPEC.md 2), and the
 * interface labels this field «یادداشت غیرپزشکی» so the boundary is visible to
 * the person typing rather than only to the schema.
 */
export const noteSchema = z.string().trim().min(1).max(2000);

/** Who referred the family to the clinic. Short, free text, optional. */
export const referralSourceSchema = z.string().trim().min(1).max(200);

/** The short note required when a relationship is recorded as `OTHER`. */
export const relationshipNoteSchema = z.string().trim().min(1).max(120);

/**
 * An Iranian mobile number in canonical national form: `09` and nine digits.
 *
 * The canonical form is the contract. A browser may send `۰۹۱۲ ۳۴۵ ۶۷۸۹`,
 * `+989123456789` or `0912-345-6789`, and the web tier folds all of them to this
 * shape before validating — the same division of labour that converts a Jalali
 * date to an ISO one in a Route Handler rather than in a shared schema.
 *
 * International numbers are out of range. This is a single-clinic product in
 * Iran, and a stored `+98` prefix would mean every screen converting back to
 * read a number aloud.
 */
export const iranMobileSchema = z
  .string()
  .regex(/^09\d{9}$/, 'must be an Iranian mobile number in the form 09XXXXXXXXX');

/**
 * An Iranian landline in canonical national form: a leading zero, an area code
 * and a subscriber number, ten or eleven digits in total.
 *
 * Ten and eleven are both real: Tehran's `021` plus eight digits is eleven,
 * while several area codes take a shorter subscriber number.
 */
export const iranLandlineSchema = z
  .string()
  .regex(/^0[1-9]\d{8,9}$/, 'must be an Iranian landline number including its area code');

/**
 * The clinic's own file number for a child.
 *
 * Assigned by the server from a sequence and immutable afterwards, so this
 * appears in responses and never in a request. Staff neither type it nor choose
 * it: a typed identifier on the busiest form in the clinic is a duplicate-key
 * error waiting to happen.
 */
export const fileNumberSchema = z.string().regex(/^\d{5,10}$/);

/**
 * A number from the clinic's existing paper files.
 *
 * Separate from `fileNumber` and independently unique. The clinic keeps paper
 * records that predate this system, and a family quoting an old number must
 * still be findable; merging the two numbering schemes into one column would
 * mean choosing which of them the system is allowed to generate.
 */
export const legacyPaperFileNumberSchema = z.string().trim().min(1).max(40);

/**
 * An Iranian national identifier (کد ملی): ten digits with a check digit.
 *
 * Optional wherever it appears. It is the strongest de-duplication key
 * available and normal to collect in Iran, but requiring it would refuse a
 * newborn who does not have one yet and would slow the phone-call path this
 * milestone exists to protect.
 *
 * The check digit is verified here rather than only in the database, because a
 * transposed digit is an ordinary typing mistake and deserves an ordinary
 * validation message. A `CHECK` still pins the ten-digit shape in PostgreSQL.
 */
export const nationalIdSchema = z
  .string()
  .regex(/^\d{10}$/, 'must be ten digits')
  .refine(hasValidNationalIdCheckDigit, 'is not a valid national identifier');

/**
 * The published algorithm: each of the first nine digits is weighted by its
 * distance from the end, the sum is taken modulo eleven, and the result is the
 * check digit — or eleven minus it, once the remainder reaches two.
 *
 * Repdigits are rejected first. `0000000000` and `1111111111` satisfy the
 * arithmetic and are not identifiers anybody holds, so accepting them would
 * make the check worse than useless: it would wave through exactly the value
 * somebody types to get past a required field.
 */
function hasValidNationalIdCheckDigit(value: string): boolean {
  if (/^(\d)\1{9}$/.test(value)) return false;

  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    sum += Number(value[index]) * (10 - index);
  }

  const remainder = sum % 11;
  const check = Number(value[9]);

  return remainder < 2 ? check === remainder : check === 11 - remainder;
}

/**
 * The masked forms an identifier takes once it leaves the domain tables.
 *
 * A full national identifier or phone number belongs in `child`, in `guardian`,
 * and in an authorised response to somebody who holds the permission to read
 * it. It does not belong in an audit payload, in a log line, or in the list of
 * duplicate candidates attached to a rejected write — all three are copies that
 * outlive the reason they were made.
 *
 * The asterisk count is the identifier's own length minus four, which is what
 * makes these shapes unsatisfiable by a real value: a ten-digit national
 * identifier can never match six asterisks and four digits. `null` stays
 * distinct from a masked value, so "a number was added" and "a number was
 * changed" remain different facts.
 *
 * Declared here rather than in `apps/api` because they describe a wire shape:
 * a strict response schema carrying one of these fails to parse if a full
 * identifier is ever serialised into it, which is the same mechanism that stops
 * a password hash reaching a browser.
 */
export const maskedNationalIdSchema = z.string().regex(/^\*{6}\d{4}$/);
export const maskedMobileSchema = z.string().regex(/^\*{7}\d{4}$/);
export const maskedLandlineSchema = z.string().regex(/^\*{6,7}\d{4}$/);

/**
 * Why a candidate was offered as a possible duplicate.
 *
 * The first two block until a member of staff acknowledges them; the rest are
 * informational and never refuse a write. Keeping both kinds in one list means
 * a rule's severity is a property of the rule rather than of the code path that
 * happened to evaluate it.
 */
export const DUPLICATE_RULES = [
  /** Blocking: an active family already holds one of the submitted mobiles. */
  'FAMILY_DUPLICATE_MOBILE',
  /** Blocking: same normalised name and identical birth date, same family. */
  'CHILD_DUPLICATE_IN_FAMILY',
  /** Informational: matching family name and a matching guardian name. */
  'SIMILAR_FAMILY_NAME_AND_GUARDIAN',
  /** Informational: same name and birth date, but in a different family. */
  'SIMILAR_CHILD_IN_OTHER_FAMILY',
  /** Informational: another family lists the same landline. */
  'SHARED_LANDLINE',
] as const;

export type DuplicateRule = (typeof DUPLICATE_RULES)[number];

export const duplicateRuleSchema = z.enum(DUPLICATE_RULES);

/** The two rules that refuse a write until acknowledged. */
export const BLOCKING_DUPLICATE_RULES: readonly DuplicateRule[] = [
  'FAMILY_DUPLICATE_MOBILE',
  'CHILD_DUPLICATE_IN_FAMILY',
];

/**
 * A family or child offered for comparison when a duplicate is suspected.
 *
 * Enough to recognise a family — its name, who answers the phone, the last four
 * digits of the number — and no more. The full number is one click away on the
 * family's own page for anyone who needs it; putting it here would copy an
 * identifier into an error body that a member of staff may never even read.
 */
export const duplicateCandidateSchema = z.strictObject({
  familyId: z.uuid(),
  /** Set when the candidate is a specific child rather than a whole family. */
  childId: z.uuid().nullable(),
  rule: duplicateRuleSchema,
  blocking: z.boolean(),
  familyName: z.string(),
  primaryGuardianName: z.string().nullable(),
  maskedMobile: maskedMobileSchema.nullable(),
  maskedLandline: maskedLandlineSchema.nullable(),
  /** Display names of the children in the candidate family, for recognition. */
  childNames: z.array(z.string()),
});

export type DuplicateCandidate = z.infer<typeof duplicateCandidateSchema>;

/**
 * The body of a refused write.
 *
 * The token addresses a server-side draft holding what was typed, so the
 * browser never has to send it back. It is bearer-secret material: it crosses
 * this boundary exactly once, so the web tier can put it in an HttpOnly cookie,
 * and appears in no log, no audit row and no URL.
 */
export const duplicateBlockedDetailsSchema = z.strictObject({
  candidates: z.array(duplicateCandidateSchema),
  draftToken: z.string().min(1),
  draftExpiresAt: z.iso.datetime(),
});

export type DuplicateBlockedDetails = z.infer<typeof duplicateBlockedDetailsSchema>;

/**
 * Informational outcomes a successful write can report.
 *
 * These are the non-blocking half of duplicate detection. A similar family or
 * child was found, the write went ahead because similarity alone is never a
 * refusal, and the interface still has to say so — a warning nobody sees is the
 * same as no warning.
 *
 * They travel as a fixed enum in a success body and then as a single
 * `?notice=` value on the redirect, mirroring the existing `?error=` mechanism.
 * A candidate's name, identifier or id is never any part of that: the closed
 * list is the whole vocabulary, which is what keeps personal data out of the
 * URL.
 */
export const NOTICE_CODES = ['SIMILAR_FAMILY_EXISTS', 'SIMILAR_CHILD_EXISTS'] as const;

export type NoticeCode = (typeof NOTICE_CODES)[number];

export const noticeCodeSchema = z.enum(NOTICE_CODES);
