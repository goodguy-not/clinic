import { z } from 'zod';
import { childSexSchema, iranMobileSchema } from '../families/common';
import { publicRequestContactTimeSchema } from './public-requests';

/**
 * The internal side of the public contact form: the inbox, and the small
 * lifecycle a colleague moves a request through.
 *
 * Milestone 9, checkpoint A4. A3 accepted the stranger's message and stopped
 * there deliberately; this is what the clinic then DOES with it.
 *
 * ================== IT IS AN INBOX, AND IT IS NOT A CRM =====================
 *
 * PROJECT_SPEC.md 11 says so in as many words, and the shapes below are what
 * that sentence looks like when it is enforced rather than repeated. There is
 * no owner, no assignee, no reminder, no due date, no priority, no lead score,
 * no pipeline stage, no activity feed, no attachment, no reply, no thread and
 * no campaign. A request is a message somebody left, five statuses say how far
 * the clinic has got with it, and the work itself happens on a telephone.
 *
 * NOTHING HERE IS EVER PUBLIC. Every shape in this file is reachable only by a
 * signed-in colleague holding `website_request.read`, and no public projection
 * in this package names any of them. The sibling file `public-requests.ts` is
 * the opposite direction — what a stranger may SEND — and the two never meet:
 * a submission response carries no identifier precisely so that nothing an
 * anonymous caller holds can address a row in this file.
 *
 * ============ THE CONTENT IS BORROWED, AND IT EXPIRES =======================
 *
 * The intake fields below are a stranger's name, telephone number and words,
 * held under a notice promising the clinic will not keep them beyond ninety
 * days. `website_request` is the only table in this product whose content is
 * ERASED IN PLACE, and the shapes here say so structurally: every read is a
 * discriminated union on `contentPurged`, so a purged request cannot carry a
 * name even by a serialisation mistake, and a consumer cannot forget to check.
 */

/**
 * THE FIVE STATUSES, FROZEN BY THE ACCEPTED PLAN AND BY PROJECT_SPEC.md 11.
 *
 * `NEW` is the arrival state and nothing ever returns to it: it means "nobody
 * at the clinic has touched this yet", which stops being true the moment
 * somebody does, and a status that could be restored would make the inbox lie
 * about which requests have been looked at.
 *
 * `CONTACTED` and `FOLLOW_UP_NEEDED` are the working pair and are freely
 * interchangeable in both directions — a colleague rings, leaves a message,
 * marks it for another try, rings again. Neither is a queue and neither
 * schedules anything; see `WEBSITE_REQUEST_LEGAL_TRANSITIONS`.
 *
 * `CONVERTED_TO_FAMILY` IS NOT A STATUS SOMEBODY TYPES. It is what LINKING a
 * request to a family produces, and the two are one act: the database refuses a
 * converted request with no family and a linked request in any other status.
 *
 * `CLOSED` is the end of the clinic's interest, and it is what starts the
 * ninety-day retention clock.
 *
 * Must stay identical to the `website_request_status` PostgreSQL enum; an
 * integration test asserts the two lists match.
 */
export const WEBSITE_REQUEST_STATUSES = [
  'NEW',
  'CONTACTED',
  'FOLLOW_UP_NEEDED',
  'CONVERTED_TO_FAMILY',
  'CLOSED',
] as const;

export type WebsiteRequestStatus = (typeof WEBSITE_REQUEST_STATUSES)[number];

export const websiteRequestStatusSchema = z.enum(WEBSITE_REQUEST_STATUSES);

/**
 * WHICH MOVES ARE LEGAL, STATED ONCE FOR BOTH TIERS AND BACKED BY A TRIGGER.
 *
 * The owner decision of checkpoint A4: the three open states are interchangeable
 * except that nothing returns to `NEW`, and BOTH END STATES ARE FINAL.
 *
 * `CLOSED` IS TERMINAL BECAUSE THE RETENTION CLOCK IS. The accepted rule erases
 * a closed, never-linked request ninety days after CLOSURE. If a closure could
 * be undone, the closure instant would be a value that moves, "this has been
 * closed for ninety days" would stop being a fact the database can hold, and an
 * erasure could be deferred indefinitely by reopening. The cost is real and was
 * accepted: a request closed by mistake is not reopened here — the colleague
 * telephones the family and works in the family record, which is where the
 * clinic's own version of the conversation belongs anyway.
 *
 * `CONVERTED_TO_FAMILY` IS TERMINAL BECAUSE THE LINK IS. A converted request has
 * become part of a family's history and is retained as history; there is no
 * later state that would tell a reader anything the link does not already say,
 * and no unlink exists in this product.
 *
 * A TRANSITION TO THE SAME STATUS IS NOT LEGAL EITHER. There is no free-text
 * reason on a status change in M9, so re-recording the status a request is
 * already in would write an audit row that says nothing and move nothing.
 *
 * IT LIVES IN THE CONTRACT SO THAT THREE PLACES CANNOT DISAGREE: the web tier
 * offers exactly these moves, NestJS refuses everything else with
 * `WEBSITE_REQUEST_TRANSITION_INVALID`, and a PostgreSQL trigger refuses them
 * again underneath both. The trigger is the authority; this is what keeps the
 * screen from offering a button the database will reject.
 */
export const WEBSITE_REQUEST_LEGAL_TRANSITIONS: Readonly<
  Record<WebsiteRequestStatus, readonly WebsiteRequestStatus[]>
> = {
  NEW: ['CONTACTED', 'FOLLOW_UP_NEEDED', 'CONVERTED_TO_FAMILY', 'CLOSED'],
  CONTACTED: ['FOLLOW_UP_NEEDED', 'CONVERTED_TO_FAMILY', 'CLOSED'],
  FOLLOW_UP_NEEDED: ['CONTACTED', 'CONVERTED_TO_FAMILY', 'CLOSED'],
  CONVERTED_TO_FAMILY: [],
  CLOSED: [],
};

export function isLegalWebsiteRequestTransition(
  from: WebsiteRequestStatus,
  to: WebsiteRequestStatus,
): boolean {
  return WEBSITE_REQUEST_LEGAL_TRANSITIONS[from].includes(to);
}

/**
 * The family a converted request became part of. TWO FIELDS.
 *
 * Enough for a colleague to recognise the record and follow the link, and
 * nothing more: no guardian, no telephone number, no child, no balance. The
 * inbox is a list of messages, and a family's own screens are where a family is
 * read — widening this shape would make the request inbox a second, unaudited
 * way to browse families.
 */
export const websiteRequestLinkedFamilySchema = z.strictObject({
  id: z.uuid(),
  familyName: z.string(),
});

export type WebsiteRequestLinkedFamily = z.infer<typeof websiteRequestLinkedFamilySchema>;

/**
 * The service the visitor named, as a colleague reads it.
 *
 * THE INTERNAL NAME, NOT THE PUBLIC SLUG. A slug is a public address and is what
 * the stranger's browser used; the person triaging the inbox needs the name the
 * rest of the application calls that service, so that "which colleague does this
 * go to?" is answerable without a second lookup.
 *
 * It is PURGEABLE, like everything else the visitor said, so it is absent from a
 * purged request along with the rest.
 */
export const websiteRequestServiceSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
});

export type WebsiteRequestService = z.infer<typeof websiteRequestServiceSchema>;

/**
 * What every request carries whatever became of its content: the lifecycle, and
 * nothing a person said.
 *
 * THIS IS EXACTLY THE ROW THAT SURVIVES THE NINETY-DAY ERASURE, and that is the
 * point of separating it. A reader can always say that a consented request
 * arrived on a day, how far the clinic got with it, and whether it became a
 * family — and can never, after the purge, say anything about anybody.
 *
 * `statusChangedAt` IS NULL EXACTLY WHILE THE STATUS IS `NEW`. It is when the
 * request was last moved, not a second audit trail: it names no actor, carries
 * no reason and records only the latest move. Who changed a status and when is
 * `audit_log`'s answer, and audit internals are never returned as ordinary
 * fields of a request.
 *
 * `closedAt` IS PRESENT EXACTLY WHEN THE STATUS IS `CLOSED`, and it is the
 * instant the retention clock starts from.
 *
 * `purgedAt` IS THE ERASURE'S OWN INSTANT and is written once. It is stated
 * beside `contentPurged` rather than instead of it, because a consumer branches
 * on the discriminator and a reader wants the date.
 */
const websiteRequestLifecycleFields = {
  id: z.uuid(),
  receivedAt: z.iso.datetime(),
  status: websiteRequestStatusSchema,
  statusChangedAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
  linkedFamily: websiteRequestLinkedFamilySchema.nullable(),
  linkedAt: z.iso.datetime().nullable(),
} as const;

/**
 * What the visitor told us, as the inbox list shows it.
 *
 * SIX TRIAGE FACTS AND A FLAG, AND NOT THE NOTE. Everything here is what
 * somebody scanning the list needs in order to decide who rings whom: a name to
 * ask for, a number to ring, the child's first name, age and sex so the call
 * reaches the right colleague, when the parent said they are free, and which
 * service they named. `hasNote` says a paragraph is waiting without printing it
 * — the note is up to two thousand characters and belongs on the one request
 * somebody has opened, not on twenty-five rows they are skimming.
 *
 * `childAgeYears` IS WHOLE YEARS AS A PARENT TYPED THEM AND IS NOT A BIRTH DATE.
 * Nothing in this product derives one from the other, and the conversion path
 * deliberately does not carry it into a child record: a child's date of birth is
 * a fact somebody at the clinic confirms and enters, and inferring it from "he
 * is six" would put a wrong, authoritative-looking date on a permanent record.
 */
const websiteRequestIntakeFields = {
  contactName: z.string(),
  contactMobile: iranMobileSchema,
  childName: z.string().nullable(),
  childAgeYears: z.number().int().nonnegative(),
  childSex: childSexSchema,
  preferredContactTime: publicRequestContactTimeSchema.nullable(),
  requestedService: websiteRequestServiceSchema.nullable(),
  hasNote: z.boolean(),
} as const;

/**
 * One row of the inbox, in whichever of the two shapes the retention rule has
 * left it.
 *
 * A DISCRIMINATED UNION RATHER THAN A ROW OF NULLABLE FIELDS. The database
 * guarantees that a live request has all four required intake columns and that a
 * purged one has none of them (`website_request_purge_chk`); this is that
 * guarantee on the wire. A purged row is not a live row with the words missing —
 * it is a different kind of thing, and a shape that could express "purged, and
 * here is the telephone number" would be a shape somebody eventually populates.
 */
export const liveWebsiteRequestSummarySchema = z.strictObject({
  contentPurged: z.literal(false),
  purgedAt: z.null(),
  ...websiteRequestLifecycleFields,
  ...websiteRequestIntakeFields,
});

export const purgedWebsiteRequestSummarySchema = z.strictObject({
  contentPurged: z.literal(true),
  purgedAt: z.iso.datetime(),
  ...websiteRequestLifecycleFields,
});

export const websiteRequestSummarySchema = z.discriminatedUnion('contentPurged', [
  liveWebsiteRequestSummarySchema,
  purgedWebsiteRequestSummarySchema,
]);

export type WebsiteRequestSummary = z.infer<typeof websiteRequestSummarySchema>;

/**
 * One request, opened.
 *
 * THE DETAIL IS THE SUMMARY PLUS THE NOTE, AND THAT IS THE WHOLE DIFFERENCE.
 * There is no history block, no list of previous statuses, no actor and no
 * timeline: those are `audit_log`'s facts, and this checkpoint's audit boundary
 * is that lifecycle acts are recorded there and are not served back as ordinary
 * fields of a request.
 *
 * A PURGED REQUEST HAS NO DETAIL BEYOND ITS LIFECYCLE, which is why the purged
 * arm is the summary's unchanged: there is nothing left to open.
 */
export const liveWebsiteRequestDetailSchema = liveWebsiteRequestSummarySchema.extend({
  note: z.string().nullable(),
});

export const websiteRequestDetailSchema = z.discriminatedUnion('contentPurged', [
  liveWebsiteRequestDetailSchema,
  purgedWebsiteRequestSummarySchema,
]);

export type WebsiteRequestDetail = z.infer<typeof websiteRequestDetailSchema>;

/** The default and the ceiling for one page of the inbox. */
export const WEBSITE_REQUEST_PAGE_SIZE_DEFAULT = 25;
export const WEBSITE_REQUEST_PAGE_SIZE_MAX = 100;

/**
 * Reading the inbox: a status filter, and a page.
 *
 * OFFSET PAGING AND NEWEST FIRST, the conventions this repository already uses
 * for a list a person reads (`ledgerPageQuerySchema`). A request is ordered by
 * when it arrived and by nothing else — arrival does not move, so there is no
 * cursor stability problem to solve, and a page number is what the person
 * looking for "the one from Tuesday" can navigate.
 *
 * THE FILTER IS A SET OF STATUSES, AND OMITTING IT MEANS ALL OF THEM. A default
 * that quietly hid the closed requests would be a default that loses somebody's
 * message; the screen chooses what it shows and says so.
 *
 * THERE IS NO SEARCH TERM, AND THAT IS DELIBERATE. Searching an inbox by
 * telephone number would make it a way to ask "has this person contacted the
 * clinic?" of a store the clinic has promised to erase, and the answer belongs
 * to the family record instead. There is no free-text search, no date range and
 * no sort parameter: this is a list of messages, not a report.
 *
 * Coerced, because these arrive as query-string values.
 */
export const websiteRequestInboxQuerySchema = z.strictObject({
  statuses: z
    .union([websiteRequestStatusSchema, z.array(websiteRequestStatusSchema).min(1)])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(WEBSITE_REQUEST_PAGE_SIZE_MAX)
    .default(WEBSITE_REQUEST_PAGE_SIZE_DEFAULT),
});

export type WebsiteRequestInboxQuery = z.infer<typeof websiteRequestInboxQuerySchema>;

/**
 * A page of the inbox, and the counts a screen needs to render its own tabs.
 *
 * `statusCounts` IS EVERY STATUS, ZERO-FILLED, AND IS NOT SCOPED BY THE FILTER.
 * It answers "how many are there of each?" for the whole inbox, so a screen
 * showing only the new ones can still say how many closed ones exist without a
 * second request — and so the number on a tab cannot disagree with the list
 * behind it. It is five integers over one table, not a report: no date range, no
 * grouping, no trend and no total by service.
 */
export const websiteRequestStatusCountSchema = z.strictObject({
  status: websiteRequestStatusSchema,
  count: z.number().int().nonnegative(),
});

export type WebsiteRequestStatusCount = z.infer<typeof websiteRequestStatusCountSchema>;

export const websiteRequestInboxResponseSchema = z.strictObject({
  requests: z.array(websiteRequestSummarySchema),
  page: z.strictObject({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  }),
  statusCounts: z.array(websiteRequestStatusCountSchema),
});

export type WebsiteRequestInboxResponse = z.infer<typeof websiteRequestInboxResponseSchema>;

/**
 * Moving a request along. ONE FIELD, AND NO REASON.
 *
 * NO FREE-TEXT REASON, WHICH IS THE FROZEN M9 RULE. A reason box on a status
 * change is where a colleague would write what the parent said — clinical
 * detail, a diagnosis somebody repeated, a family's circumstances — into the one
 * table this product erases and into the audit rows that outlive it. What
 * somebody learns on the telephone belongs in the family record, written
 * deliberately, by somebody who decided to keep it.
 *
 * `CONVERTED_TO_FAMILY` IS NOT REACHABLE HERE. Conversion means a family, and a
 * status that claimed one without naming it would be a lie the database refuses
 * anyway; the link route is the only way in.
 */
export const changeWebsiteRequestStatusRequestSchema = z.strictObject({
  status: websiteRequestStatusSchema.exclude(['CONVERTED_TO_FAMILY', 'NEW']),
});

export type ChangeWebsiteRequestStatusRequest = z.infer<
  typeof changeWebsiteRequestStatusRequestSchema
>;

/**
 * Linking a request to a family that already exists. ONE FIELD.
 *
 * THIS DOES NOT CREATE A FAMILY AND CANNOT. The other half of the accepted
 * conversion path — "this is a new family" — is the EXISTING registration
 * workflow, with its existing duplicate detection, its existing confirmation
 * screen and its existing `family.create` authority; the request's fields are
 * shown beside that form for somebody to copy from, and the family that comes
 * out of it is linked with this same route afterwards. There is deliberately no
 * second family-creation API for website requests, and no one-click conversion:
 * a stranger's form submission must never become a clinic record without a
 * member of staff going through the workflow that protects family integrity.
 *
 * A REQUEST IS LINKED AT MOST ONCE, EVER. A second link — to the same family or
 * to a different one — is `WEBSITE_REQUEST_ALREADY_LINKED`, refused by the
 * service and by a trigger underneath it, because a link is a claim about whose
 * message this was and correcting it silently would rewrite that claim.
 */
export const linkWebsiteRequestRequestSchema = z.strictObject({
  familyId: z.uuid(),
});

export type LinkWebsiteRequestRequest = z.infer<typeof linkWebsiteRequestRequestSchema>;
