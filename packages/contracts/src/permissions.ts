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
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const permissionSchema = z.enum(PERMISSIONS);
