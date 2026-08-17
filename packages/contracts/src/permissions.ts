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
 * What reading the dashboard requires, ALL THREE OF THEM.
 *
 * The same reasoning as `FAMILY_ACCOUNT_READ_PERMISSIONS` below, applied to the
 * screen that aggregates three modules: the dashboard states today's
 * appointments and unresolved outcomes (`appointment.read`), the caller's own
 * recorded payments for the day (`payment.read`) and the promises due and
 * overdue (`promise.read`). A route that demanded only the first would serve two
 * kinds of information its permission never mentioned.
 *
 * AND, NOT OR, in both tiers — `PermissionsGuard` in NestJS and `requireSession`
 * on the page.
 *
 * IT IS NOT THE FINANCIAL AUTHORITY. Holding these three gets a caller the
 * dashboard with `clinicFinancial: null`; the clinic-wide block needs
 * `report.read_financial` as well, and that is decided inside the response
 * rather than by refusing the request.
 *
 * IT CHANGES NO ACCESS TODAY: manager and receptionist both hold all three.
 */
export const DASHBOARD_READ_PERMISSIONS = [
  'appointment.read',
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

export const permissionSchema = z.enum(PERMISSIONS);
