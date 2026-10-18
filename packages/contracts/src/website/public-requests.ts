import { z } from 'zod';
import { childSexSchema, iranMobileSchema } from '../families/common';
import { PUBLIC_PLAIN_TEXT_PATTERN, publicSlugSchema } from './common';

/**
 * The one thing a stranger may ask this system to do.
 *
 * Milestone 9, checkpoint A3. Every other public shape in this directory is a
 * PROJECTION — what the clinic has decided to say to the world. This one is the
 * opposite direction and the first anonymous WRITE the product has ever
 * accepted: a parent who has read a page and wants somebody to call them back.
 *
 * IT IS NOT A REGISTRATION, AND NOTHING HERE REUSES ONE. There is no family
 * shape, no child shape, no guardian, no national identifier, no birth date, no
 * file number and no appointment. A submission is a stranger's message; a
 * family is a clinic record somebody at the clinic decided to create, and the
 * step between the two is a member of staff (PROJECT_SPEC.md 11, and the
 * conversion path A4 owns). Reusing the registration contracts here would put
 * the two one careless import apart.
 *
 * IT CARRIES NO CLINICAL QUESTION. No diagnosis, no referral letter, no
 * screening instrument, no severity, no history. Age and sex are here because
 * whoever returns the call needs to know which colleague to put it in front of,
 * and for no other reason — they are STAFF-TRIAGE FACTS, and nothing in this
 * application decides anything from them. There is deliberately no eligibility
 * rule anywhere in the submission path: this product does not refuse a family
 * on demographics, and validation that did so would be an eligibility policy
 * nobody approved, hidden in a schema.
 */

/**
 * The wording versions a submission may be made under.
 *
 * THE VERSION IS AN IDENTIFIER, NOT THE WORDING. Final privacy and consent copy
 * is owner-supplied and lives in the web tier beside the checkbox the visitor
 * actually reads; what has to be agreed ACROSS the tiers is the NAME of the
 * text that was shown, because "they consented" is not evidence unless the
 * record says what they consented to.
 *
 * A CLOSED LIST RATHER THAN FREE TEXT, and that is the load-bearing half. If
 * the web tier could send any string, the stored version would be whatever a
 * caller claimed, and the evidence would be worth exactly nothing. Because the
 * list is frozen here and the API refuses anything outside it, a stored version
 * is a value BOTH tiers agreed to before the submission happened.
 *
 * Publishing new wording is therefore a deliberate two-line change — a new
 * entry here, and the copy behind it — and old rows keep naming the text their
 * submitter actually saw. Nothing rewrites a historical consent record, for the
 * reason a tariff change never rewrites a historical charge.
 */
export const PUBLIC_REQUEST_CONSENT_VERSIONS = ['2026-08-27'] as const;

export type PublicRequestConsentVersion = (typeof PUBLIC_REQUEST_CONSENT_VERSIONS)[number];

/** The version a form should be showing today. */
export const CURRENT_PUBLIC_REQUEST_CONSENT_VERSION: PublicRequestConsentVersion = '2026-08-27';

/**
 * The upper bound on a submitted age, and it is a SANITY BOUND ONLY.
 *
 * Whole years from 0 to 99 (owner decision T-018, M10-A10; it was 120). Still
 * a bound that decides nothing about eligibility: any narrower number —
 * eighteen, fourteen, seven — would be this clinic refusing to hear from
 * somebody on the basis of their age, written into a validation rule where
 * nobody would ever find it and nobody ever approved it. Who the clinic can
 * help is a conversation a member of staff has, not a 400 a stranger gets.
 *
 * NEW SUBMISSIONS ONLY. The column's CHECK stays 0–120 and the staff read
 * schema bounds nothing, so a request stored under the old bound is read,
 * listed and erased exactly as before.
 */
export const PUBLIC_REQUEST_MAX_CHILD_AGE_YEARS = 99;

/**
 * When a parent would rather be telephoned. FOUR VALUES, OWNER-APPROVED AND
 * FROZEN.
 *
 * THEY EXPRESS A PREFERENCE AND NOTHING ELSE. They are not an SLA, not a promise
 * that the clinic will call in that period, and not a commitment of any kind.
 * Nothing in this application schedules, queues, reminds, prioritises or
 * measures anything from this field — it is a sentence a colleague reads before
 * picking up the telephone, and the product would behave identically if every
 * request carried the same value.
 *
 * NO CLOCK RANGES, DELIBERATELY. «MORNING» is not 08:00–12:00 here or anywhere
 * else in M9. Binding these to times would put a second, quieter answer to "when
 * is the clinic open?" into a contract — one that the real opening hours in
 * `clinic_public_profile` could then contradict — and it would turn a parent's
 * rough preference into a figure somebody could hold the clinic to. Reading
 * clinic hours OUT of these values is equally forbidden: they say when a PARENT
 * is free, which is not information about the clinic at all.
 *
 * `NO_PREFERENCE` IS A REAL ANSWER, NOT AN ABSENT ONE, and it is the pair to
 * `UNSPECIFIED` in the child-sex vocabulary. "Any time suits us" is a useful
 * thing for a parent to say and a useful thing for a colleague to read. It is
 * NOT the same as omitting the field, which means the form did not ask or the
 * parent skipped it — and because the field is optional, both remain valid and
 * distinguishable.
 *
 * Must stay identical to the `website_request_contact_time` PostgreSQL enum; an
 * integration test asserts the two lists match.
 */
export const PUBLIC_REQUEST_CONTACT_TIMES = [
  'MORNING',
  'AFTERNOON',
  'EVENING',
  'NO_PREFERENCE',
] as const;

export type PublicRequestContactTime = (typeof PUBLIC_REQUEST_CONTACT_TIMES)[number];

export const publicRequestContactTimeSchema = z.enum(PUBLIC_REQUEST_CONTACT_TIMES);

/**
 * Intake free text: trimmed, bounded, and refusing a less-than sign.
 *
 * The markup rule is the one A2 applies to published copy, applied here for a
 * different reason. Published copy is rendered to strangers; THIS text is
 * rendered to the receptionist reading the inbox, and it is written by an
 * anonymous stranger rather than by a manager — the more hostile of the two
 * directions. Refusing to STORE markup means there is no sanitiser anywhere in
 * the inbox A4 builds, and nothing for one to be misconfigured against.
 */
const intakeText = (max: number) =>
  z.string().trim().min(1).max(max).regex(PUBLIC_PLAIN_TEXT_PATTERN, 'must not contain markup');

/**
 * What an anonymous visitor submits. TEN FIELDS, SIX OF THEM REQUIRED.
 *
 * `serviceSlug` IS REQUIRED AND NULLABLE, AND THE TWO HALVES ARE DIFFERENT
 * FACTS. `null` is the accepted "I am not sure which service I need", which a
 * form must be able to express — a parent who knew the vocabulary would
 * probably not be writing in. Omitting the key entirely is not that: it is a
 * form that forgot to ask, and it is refused.
 *
 * It is a SLUG rather than an id, for the A1 reason (DECISION_LOG,
 * 2026-08-21): a public record is addressed by its slug and by nothing else,
 * and an internal service UUID has no business on a page a stranger reads.
 *
 * `childSex` IS REQUIRED, WITH NO DEFAULT AND NO OMISSION. `UNSPECIFIED` is a
 * real answer in this vocabulary and always has been — it means "not stated",
 * which is a perfectly good thing for a parent to say — so it can be CHOSEN.
 * What it may not be is INFERRED from an absent field, because then "they
 * declined to say" and "the form was broken" become the same stored value, and
 * the triage fact a colleague reads would be one nobody actually gave. A
 * preselected default in the eventual form would recreate the same problem one
 * tier up, so that form must start with nothing chosen.
 *
 * `consent` IS `true` OR THE SUBMISSION IS REFUSED. Not a boolean: the literal.
 * A schema that accepted `false` would be a schema that accepted a submission
 * from somebody who declined, and left it to the service layer to remember.
 */
export const publicRequestSubmissionSchema = z.strictObject({
  /** Whoever is asking to be called back. A parent, usually; never verified. */
  contactName: intakeText(120),
  /**
   * Canonical Iranian mobile form, exactly as every internal contract uses it.
   * The web tier folds Persian digits, `+98` and spacing before it gets here —
   * the same division of labour that converts a Jalali date in a Route Handler.
   */
  contactMobile: iranMobileSchema,
  /** A published service's slug, or `null` for "not sure". */
  serviceSlug: publicSlugSchema.nullable(),
  /** Optional: a first name makes the call back less awkward, and nothing more. */
  childName: intakeText(120).nullable().optional(),
  /** Whole years. See `PUBLIC_REQUEST_MAX_CHILD_AGE_YEARS`. */
  childAgeYears: z.number().int().min(0).max(PUBLIC_REQUEST_MAX_CHILD_AGE_YEARS),
  /** The existing `child_sex` vocabulary, reused rather than restated. */
  childSex: childSexSchema,
  /**
   * Optional: when it suits them to be telephoned, from the frozen four.
   *
   * OPTIONAL AND CLOSED, WHICH ARE DIFFERENT PROPERTIES. A form need not ask —
   * the public form is meant to stay short — and an omitted field is valid.
   * What a form may NOT do is send something outside the vocabulary, because
   * "«صبح‌ها بعد از ۹»" typed into a box is a sentence somebody has to read and
   * interpret, and a colleague scanning an inbox needs a value they can sort by.
   *
   * `NO_PREFERENCE` and OMISSION are both valid and are not the same fact: the
   * first is a parent saying any time suits them, the second is a form that did
   * not ask. See `PUBLIC_REQUEST_CONTACT_TIMES` for why there are no clock
   * ranges behind any of these.
   */
  preferredContactTime: publicRequestContactTimeSchema.nullable().optional(),
  /** Optional: anything else they want to say. Never a clinical field. */
  note: intakeText(2000).nullable().optional(),
  consent: z.literal(true),
  consentVersion: z.enum(PUBLIC_REQUEST_CONSENT_VERSIONS),
});

export type PublicRequestSubmission = z.infer<typeof publicRequestSubmissionSchema>;

/**
 * WHAT A STRANGER IS TOLD: that the clinic has their message. ONE FIELD.
 *
 * NO IDENTIFIER, and its absence is the design rather than an omission. An id
 * in this response would be a handle an anonymous caller could keep, quote,
 * enumerate or ask about later, and the product has no route that would answer
 * — building one would be a public read of the inbox, which is exactly what
 * this checkpoint may not create.
 *
 * NO INDICATION OF DEDUPLICATION EITHER, and this is the sharper rule. A second
 * equivalent submission stores nothing and returns THIS EXACT BODY, byte for
 * byte, with the same status. Any difference — a flag, a different code, a
 * changed id — would let anybody holding a mobile number ask this endpoint
 * whether that person has already contacted the clinic, which is a disclosure
 * about a real family made to a stranger.
 *
 * `received: true` rather than an empty object, so the web tier parses a shape
 * rather than trusting a status code.
 */
export const publicRequestSubmissionResponseSchema = z.strictObject({
  received: z.literal(true),
});

export type PublicRequestSubmissionResponse = z.infer<typeof publicRequestSubmissionResponseSchema>;
