import { z } from 'zod';

/**
 * Every permission that exists in Milestone 1.
 *
 * Later milestones append to this list; the guard design in `apps/api` does not
 * change when they do.
 *
 * These names live here because Next needs them to decide whether to render a
 * management surface. The authoritative role -> permission map lives in
 * `apps/api` and nowhere else: Next never derives permissions from a role, it
 * only reads the resolved list NestJS returns, and NestJS re-resolves them from
 * the database on every request.
 */
export const PERMISSIONS = [
  'user.read',
  'user.create',
  'user.update_role',
  'user.update_status',
  'user.reset_password',
  'user.unlock',
  'session.revoke_any',

  // Clinic reference data. Manager-only: PROJECT_SPEC.md 4 places configuration
  // with the manager and explicitly bars the receptionist from global tariff
  // changes. The receptionist holds none of these until a workflow needs them,
  // which is the appointment milestone, not this one.
  'therapist.read',
  'therapist.create',
  'therapist.update',
  'therapist.update_status',
  'service.read',
  'service.create',
  'service.update',
  'service.update_status',
  'room.read',
  'room.create',
  'room.update',
  'room.update_status',
  'tariff.read',
  'tariff.create',
  // Voiding is separate from creating: a correction to a price already in
  // effect is a different authority from setting one, and later milestones may
  // grant them differently.
  'tariff.void',

  // Families and children. The first permissions a receptionist has ever held:
  // PROJECT_SPEC.md 4 places family/child management with them and restricts
  // them only on financial deletion, tariffs, corrections and security
  // administration — none of which these are.
  //
  // `update_status` is deactivation and reactivation. It is granted to the
  // receptionist deliberately: somebody who cannot deactivate a record entered
  // by mistake will reuse it or leave it in the active list, and both are worse
  // than an audited, reversible status change.
  'family.read',
  'family.create',
  'family.update',
  'family.update_status',
  'child.read',
  'child.create',
  'child.update',
  'child.update_status',

  // Appointments. Seven verbs rather than one `appointment.write`, because they
  // are seven different authorities over the same row: completing a session is
  // what will create the primary session charge (PROJECT_SPEC.md 6), cancelling
  // deliberately creates none, and reversing a completion voids or offsets a
  // financial record. Treating those as one permission would make the no-show and
  // correction policies, both still unresolved, impossible to express without a
  // schema change.
  //
  // The list is exactly the authorities this product grants. A name nobody
  // reaches is not a placeholder for a future decision — it is vocabulary a
  // reader has to interpret and a role map has to keep withholding.
  'appointment.read',
  'appointment.create',
  'appointment.update',
  'appointment.cancel',
  'appointment.complete',
  'appointment.reopen',
  // Booking outside a therapist's availability (PROJECT_SPEC.md 5, "blocked or
  // requires an authorized, recorded override"). A separate authority from
  // `appointment.create` so the override stays a deliberate, separately grantable
  // act with a recorded reason, rather than something every booking implies. It
  // authorizes nothing else: no other conflict may be overridden, and no other
  // rule reads this name.
  'appointment.override_availability',

  // Therapist availability: recurring working windows and dated exceptions. A
  // permission of its own rather than `therapist.update`, because a receptionist
  // may plausibly maintain a schedule without being able to edit the therapist
  // record itself.
  'availability.read',
  'availability.manage',

  // The ledger. Four verbs over one record, and the split is the approved
  // authority boundary rather than a granularity preference: raising the charge
  // for a session that happened is the ordinary end of the diary work a
  // receptionist already owns, while withdrawing one or reducing one is a
  // financial correction PROJECT_SPEC.md 4 keeps away from that role
  // (DECISION_LOG, 2026-08-14 — Charge adjustment and void authority is
  // manager-only).
  //
  // `charge.post` covers the explicit re-post, which is idempotent: a retry
  // against a participant that already has a valid charge returns that charge
  // rather than raising a second one, so holding this permission never lets a
  // receptionist duplicate money.
  //
  // There is deliberately NO time-boxed variant — no `charge.void_same_day`, no
  // window that expires. Authority that expires is authority whose last day is
  // the day a mistake becomes unfixable by the person who made it.
  'charge.read',
  'charge.post',
  'charge.void',
  'charge.adjust',

  // Money in. Six verbs over two records, and the split is the same authority
  // boundary the ledger draws, seen from the payment side: recording money that
  // arrived is the counter work a receptionist owns, and REVERSING a financial
  // record is the manager's (DECISION_LOG, 2026-08-15 — Payment void is
  // manager-only). There is again no time-boxed variant — no
  // `payment.void_same_day` — for the reason `charge.void` has none.
  //
  // A promise is not money. `promise.resolve` covers fulfilling, rescheduling
  // and cancelling as ONE authority rather than three, because none of them
  // moves a rial: a promise never changes the family's financial position in
  // any state (CLAUDE.md), so the three acts carry the same risk and splitting
  // them would be granularity without a decision behind it. The payment that
  // fulfils a promise is created under `payment.create` and voided under
  // `payment.void`, which is where the money authority stays.
  'payment.read',
  'payment.create',
  'payment.void',
  'promise.read',
  'promise.create',
  'promise.resolve',

  // Reporting. TWO NAMES, AND THE OPERATIONAL READS GET NEITHER OF THEM.
  //
  // Milestone 7 adds the clinic's first clinic-wide reads, and most of them are
  // already expressible: the session report and the therapist activity report
  // are the diary, read under `appointment.read`; the promise report is the
  // promise workflow the receptionist owns, read under `promise.read`; the
  // dashboard is those three authorities on one screen. Inventing
  // `report.read_sessions` beside `appointment.read` would be a second name for
  // one authority, and a role map would then have to keep the two in step
  // forever.
  //
  // What is genuinely new is the CLINIC-WIDE FINANCIAL read and the PER-USER
  // FINANCIAL ATTRIBUTION that comes with it: every family's balance in one
  // page, every family's payments in one page, and what each member of staff
  // took in. A receptionist holds `payment.read` because they record money and
  // read the family in front of them; that is not the same authority as the
  // clinic's whole financial position, and no existing name says so. Hence
  // `report.read_financial`, held by the manager alone. It is what the payments
  // report and the family-accounts report demand, and what decides whether the
  // dashboard's clinic-wide financial block is populated or null.
  //
  // `report.export` is separate from reading, because extracting a file is a
  // different act from looking at a screen: the file leaves the system, outlives
  // the session, and is the one reporting act the accepted plan requires to be
  // audited. A role that may read a report is not thereby a role that may carry
  // it out of the building, and holding these as one permission would make that
  // distinction unstateable. Manager-only, and no export behaviour exists yet —
  // the authority is settled here, and the CSV that uses it is a later
  // checkpoint.
  'report.read_financial',
  'report.export',

  // Therapist settlement (Milestone 8). SEVEN NAMES, EVERY ONE OF THEM
  // MANAGER-ONLY, AND THE RECEPTIONIST RECEIVES NONE OF THEM.
  //
  // This is the first authority in the product over what a THERAPIST earns
  // rather than what a FAMILY owes, and the two are different enough that not
  // one existing name stretches to cover it. A receptionist holds `charge.read`
  // because they read the account of the family in front of them; that says
  // nothing about whether they may see what each therapist takes home, and
  // PROJECT_SPEC.md 4 keeps clinic configuration and financial correction away
  // from the role. Every name below therefore stays with the manager, and the
  // negative half is pinned by a test.
  //
  // THREE NAMES FOR THE RULE AND THREE FOR THE FACT, plus one for the close.
  // The split is the same authority boundary the ledger draws: setting the
  // agreed percentage (`therapist_share.create`) is configuration, withdrawing
  // one (`therapist_share.void`) is a correction to configuration, and neither
  // is the same act as deciding what one particular session earned
  // (`settlement.rate`). A share rule is never edited — a correction voids the
  // row and writes a replacement, exactly as a tariff does — which is why there
  // is no `therapist_share.update`.
  //
  // `settlement.void_rating` IS SEPARATE FROM `settlement.rate` AND THAT
  // SEPARATION IS LOAD-BEARING. Deciding a session's share and WITHDRAWING a
  // decision somebody has already been shown are different authorities, for the
  // reason `charge.post` and `charge.void` are; and because they are two names,
  // the atomic correction can require BOTH of them
  // (`SETTLEMENT_RATING_CORRECTION_PERMISSIONS`), which is a demand that could
  // not be expressed at all if rating and un-rating were one permission.
  //
  // `settlement.close` IS ITS OWN AUTHORITY because closing is irreversible.
  // There is no un-close anywhere in this product: a closed period is immutable
  // and is never reopened, so the act of closing is the one act in this
  // milestone that cannot be corrected by a later act of the same kind. An
  // authority that irreversible does not travel as a side effect of being
  // allowed to read a statement.
  //
  // THERE IS NO THERAPIST-FACING PERMISSION OF ANY KIND HERE, and none is
  // withheld pending a decision either — a therapist has no account in this
  // product (PROJECT_SPEC.md: no parent or therapist portal in the initial
  // scope), so a name they could hold would be vocabulary describing a role
  // that cannot log in. A therapist sees their settlement because a manager
  // shows it to them.
  //
  // NO EXPORT NAME IS ADDED. Taking the settlement file out of the building is
  // `report.export`, the authority Milestone 7 already settled for exactly this
  // purpose, ANDed with `settlement.read` below. A `settlement.export` would be
  // a second answer to a question that already has one.
  'therapist_share.read',
  'therapist_share.create',
  'therapist_share.void',
  'settlement.read',
  'settlement.rate',
  'settlement.void_rating',
  'settlement.close',

  // The public website (Milestone 9, checkpoint A1). THREE NAMES, ALL THREE
  // MANAGER-ONLY, AND THE RECEPTIONIST RECEIVES NONE OF THEM.
  //
  // This is the first authority in the product over what the clinic says to
  // PEOPLE WHO ARE NOT ITS PATIENTS, and that is a different kind of act from
  // everything above: an internal mistake is corrected internally, while a
  // published one is corrected in front of the town, and may have been copied
  // by a search engine before anybody noticed.
  //
  // `therapist.publish_profile` IS SEPARATE FROM `therapist.update`, AND THE
  // SEPARATION IS THE WHOLE OPT-IN MODEL. Editing the personnel row — the
  // name the diary sorts by, the specialty, the services they support — is
  // clinic administration. Deciding that a named human being appears on a
  // public website, with a photograph and a biography, is a decision ABOUT
  // THAT PERSON, taken with their agreement, and it must be grantable and
  // revocable on its own. One `therapist.update` covering both would mean that
  // anybody allowed to fix a misspelt specialty could publish a colleague.
  //
  // `clinic_profile.read` EXISTS BESIDE `clinic_profile.update` for the reason
  // every other read/write pair in this list does: seeing the address and
  // telephone number the site publishes is not the same authority as changing
  // them. The PUBLIC read of that profile needs NEITHER — it is the website,
  // and it holds no permissions at all (see the route classification in
  // `apps/api/src/website`).
  //
  // THE RECEPTIONIST HOLDS NONE OF THE THREE, AND THAT IS A FROZEN PRODUCT
  // RULE RATHER THAN A DEFAULT. A later checkpoint may let this role DRAFT
  // public content — write a description, prepare an article — and drafting is
  // deliberately not expressible with any name here. Draft authority does not
  // imply publish authority, so the permission that publishes will never be
  // the permission that writes.
  //
  // NO NAME IS ADDED FOR PUBLISHING A SERVICE. A service's public description,
  // its public slug and whether it is public at all are columns on the catalog
  // row, written under `service.update`, which has been manager-only since
  // Milestone 2 and is held by nobody else. A second name for that same act
  // would be vocabulary with no decision behind it.
  'therapist.publish_profile',
  'clinic_profile.read',
  'clinic_profile.update',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * What reading a family account requires, ALL THREE OF THEM.
 *
 * The response is one screen and three authorities. It carries the charges and
 * their concessions (`charge.read`), and from Milestone 6 a whole-family
 * position stating what has been paid and what is due (`payment.read`) together
 * with the open and overdue promise counts (`promise.read`). A caller that
 * demanded only the first would receive two kinds of information its permission
 * never mentioned, and the permission model would describe the product
 * inaccurately — which is how a later role that should see charges but not money
 * quietly gets both.
 *
 * AND, NOT OR. Every named permission is required, in both tiers: NestJS refuses
 * the route through `PermissionsGuard`, and the account page refuses to render
 * through `requireSession`.
 *
 * IT LIVES HERE FOR THE REASON `PERMISSIONS` DOES. This is not the role map —
 * that stays in `apps/api` and nowhere else. This is the authority the frozen
 * family-account route names, which both the guard and the page that renders its
 * response have to state identically; two lists would be two answers, and the
 * one on the page is the one nobody notices drifting.
 *
 * IT CHANGES NO ACCESS TODAY: manager and receptionist both hold all three, and
 * a test in each tier pins that.
 */
export const FAMILY_ACCOUNT_READ_PERMISSIONS = [
  'charge.read',
  'payment.read',
  'promise.read',
] as const satisfies readonly Permission[];

/**
 * What reading the dashboard requires, ALL FOUR OF THEM.
 *
 * The same reasoning as `FAMILY_ACCOUNT_READ_PERMISSIONS` below, applied to the
 * screen that aggregates four modules: the dashboard states today's appointments
 * and unresolved outcomes (`appointment.read`), whether this day's completed and
 * attended sessions carry a valid charge (`charge.read`), the caller's own
 * recorded payments for the day (`payment.read`) and the promises due and
 * overdue (`promise.read`). A route that demanded only the first would serve
 * three kinds of information its permission never mentioned.
 *
 * `charge.read` IS HERE BECAUSE `unchargedCompletedSessionCount` IS A LEDGER
 * FACT. That count is `session_charge` read through the ledger's own
 * `voided_at IS NULL` predicate, and a route that stated it without naming the
 * authority to read a charge would be a side channel: a future role holding the
 * diary and the promise workflow but not the ledger would learn, seat by seat,
 * which of the clinic's sessions are unbilled. The permission model has to be an
 * accurate description of what the route reads, or withholding an authority
 * stops meaning anything.
 *
 * AND, NOT OR, in both tiers — `PermissionsGuard` in NestJS and `requireSession`
 * on the page.
 *
 * IT IS NOT THE FINANCIAL AUTHORITY. Holding these four gets a caller the
 * `OWN_ENTRIES_ONLY` variant, whose clinic-wide financial key is absent rather
 * than empty; the `CLINIC_WIDE` variant needs `report.read_financial` as well,
 * and that is decided inside the response rather than by refusing the request.
 *
 * IT CHANGES NO ACCESS TODAY: manager and receptionist both hold all four.
 */
export const DASHBOARD_READ_PERMISSIONS = [
  'appointment.read',
  'charge.read',
  'payment.read',
  'promise.read',
] as const satisfies readonly Permission[];

/**
 * What the clinic-wide payments report requires.
 *
 * `payment.read` because it reads payments, and `report.read_financial` because
 * it reads EVERY family's payments and says who recorded each one. Naming both
 * keeps the permission model an accurate description of the route: the second
 * name is the one a receptionist does not hold, and it is the reason this report
 * refuses them.
 */
export const PAYMENT_REPORT_READ_PERMISSIONS = [
  'payment.read',
  'report.read_financial',
] as const satisfies readonly Permission[];

/**
 * What the clinic-wide family-accounts report requires: everything reading one
 * family's account requires, plus the authority to read every family's at once.
 *
 * A position is charges, money and promise counts, so the same three reads are
 * named here as on the single account; the fourth name is what makes this the
 * manager's report rather than a bulk version of a receptionist's screen.
 */
export const FAMILY_ACCOUNT_REPORT_READ_PERMISSIONS = [
  'charge.read',
  'payment.read',
  'promise.read',
  'report.read_financial',
] as const satisfies readonly Permission[];

/**
 * WHAT EXPORTING A REPORT REQUIRES: everything READING it requires, plus
 * `report.export`.
 *
 * THE FIVE LISTS BELOW ARE THE C5 AUTHORITY MODEL, AND THE SHAPE IS THE POINT.
 * An export is not a weaker read and it is not a stronger one: it is the same
 * facts leaving the system as a file, so the route names every authority the
 * READ names and adds the one authority the ACT needs. Two consequences follow,
 * and both are deliberate:
 *
 *   * A RECEPTIONIST IS REFUSED EVERY EXPORT, including the three operational
 *     reports they may read all day on the screen. That is the frozen owner
 *     decision — export is manager-only — and it is the whole reason
 *     `report.export` was made a separate name rather than folded into a read
 *     (see the comment on the permission itself, above).
 *   * REVOKING A READ TAKES ITS EXPORT WITH IT. Somebody who loses
 *     `payment.read` cannot keep downloading the payments file, because the
 *     export names `payment.read` too. A list that named `report.export` ALONE
 *     would have made the file the widest door in the building: one permission
 *     that opens every report regardless of what its holder may look at.
 *
 * THE LISTS LIVE HERE FOR THE REASON THE READ LISTS DO. The web tier gates the
 * download control that renders beside each report and has to demand exactly
 * what the route demands; one list stated once is the only way the two cannot
 * drift. `PermissionsGuard` in NestJS remains the authoritative refusal, and no
 * hidden button is ever the enforcement.
 *
 * THEY CHANGE NO EXISTING ACCESS. `report.export` is a name the receptionist has
 * never held and none of these lists grants it to anybody; the manager holds
 * every permission and therefore holds all five.
 */
export const SESSION_REPORT_EXPORT_PERMISSIONS = [
  'appointment.read',
  'report.export',
] as const satisfies readonly Permission[];

export const PROMISE_REPORT_EXPORT_PERMISSIONS = [
  'promise.read',
  'report.export',
] as const satisfies readonly Permission[];

export const THERAPIST_ACTIVITY_EXPORT_PERMISSIONS = [
  'appointment.read',
  'report.export',
] as const satisfies readonly Permission[];

/**
 * The financial exports name the financial read as well, so the file cannot be
 * taken by somebody who may not open the screen it comes from.
 */
export const PAYMENT_REPORT_EXPORT_PERMISSIONS = [
  ...PAYMENT_REPORT_READ_PERMISSIONS,
  'report.export',
] as const satisfies readonly Permission[];

export const FAMILY_ACCOUNT_REPORT_EXPORT_PERMISSIONS = [
  ...FAMILY_ACCOUNT_REPORT_READ_PERMISSIONS,
  'report.export',
] as const satisfies readonly Permission[];

/**
 * WHAT EXPORTING A SETTLEMENT STATEMENT REQUIRES: reading it, plus carrying it
 * out of the building.
 *
 * The Milestone 7 export shape applied unchanged to the first Milestone 8 file
 * (see the five lists above): the read authority AND `report.export`, so
 * revoking `settlement.read` takes the download with it and no single
 * permission is ever the widest door in the building.
 *
 * NO NEW EXPORT NAME WAS INVENTED FOR SETTLEMENT. `report.export` already means
 * "may take facts out of this system as a file", which is exactly what this is;
 * a `settlement.export` would be a second answer to a question that has one,
 * and the two would have to be kept in step by hand forever.
 */
export const SETTLEMENT_EXPORT_PERMISSIONS = [
  'settlement.read',
  'report.export',
] as const satisfies readonly Permission[];

/**
 * WHAT CORRECTING A RATING REQUIRES: BOTH HALVES OF THE ACT.
 *
 * `correctSessionRatingRequestSchema` withdraws a rating and writes its
 * replacement in one transaction, because a closed period depends on the
 * original and the gap between two separate calls is observable — a statement
 * read in that gap reports the session as unrated, and a close performed in it
 * excludes the session permanently. An act that genuinely does two things names
 * both authorities.
 *
 * AND, NOT OR, in both tiers. A caller holding `settlement.rate` alone must not
 * reach a request that withdraws somebody's recorded earnings, and a caller
 * holding `settlement.void_rating` alone must not reach one that decides a new
 * percentage. Folding the two into a single `settlement.manage` would have made
 * this demand inexpressible — which is the reason they are two names in
 * `PERMISSIONS` at all.
 *
 * IT GRANTS NOTHING NEW. The manager holds both; the receptionist holds
 * neither, and holds no settlement permission of any kind.
 */
export const SETTLEMENT_RATING_CORRECTION_PERMISSIONS = [
  'settlement.void_rating',
  'settlement.rate',
] as const satisfies readonly Permission[];

export const permissionSchema = z.enum(PERMISSIONS);
