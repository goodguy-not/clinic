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
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const permissionSchema = z.enum(PERMISSIONS);
