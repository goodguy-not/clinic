import { PERMISSIONS, type Permission, type UserRole } from '@clinic/contracts';

/**
 * The authoritative role to permission map.
 *
 * This lives in `apps/api` and nowhere else. The permission *names* are shared
 * through `@clinic/contracts` so Next can decide what to render, but Next never
 * derives permissions from a role: it reads the resolved list NestJS returns,
 * and NestJS re-resolves that list from the database on every request. A role
 * or status change therefore takes effect on the very next request with no
 * cached claim to go stale.
 *
 * `Record<UserRole, ...>` makes the map exhaustive: adding a role to the
 * contract without deciding its permissions is a compile error, which is the
 * point of keeping roles a code enum rather than data.
 *
 * A receptionist held no permission at all through Milestones 1 and 2. From
 * Milestone 3 they hold the family and child workflow, and from the booking
 * checkpoint of Milestone 4 they hold what entering an appointment requires and
 * nothing more. A test asserts both halves of that — what they have, and what
 * they still do not.
 *
 * THE CATALOG PERMISSIONS ARE READS. PROJECT_SPEC.md 4 places clinic
 * configuration with the manager and bars the receptionist from global tariff
 * CHANGES; it does not bar them from seeing which services exist and what a
 * session costs, both of which somebody running the diary has to be able to look
 * up. Every `.create`, `.update` and `.update_status` on every catalog entity —
 * `tariff.create` and `tariff.void` included — stays with the manager.
 *
 * `availability.read` without `availability.manage`: a booking screen has to show
 * when a therapist works, and maintaining that schedule is a different authority.
 *
 * THE APPOINTMENT SET IS THE OPERATIONAL ONE. A receptionist runs the diary:
 * they enter a booking, move it, cancel it, record that a session happened, and —
 * with a mandatory recorded reason — book outside a therapist's hours, which is
 * the approved override (PROJECT_SPEC.md 5). What they do not hold is
 * `appointment.reopen`: reversing a completion voids or offsets a financial
 * record, which PROJECT_SPEC.md 4 keeps away from this role.
 *
 * THE LEDGER SPLIT IS THE SAME BOUNDARY SEEN FROM THE MONEY SIDE. A
 * receptionist reads the family account and posts the charge for a session that
 * happened; voiding a charge and reducing one are the manager's, and no
 * time-boxed variant of either exists.
 *
 * MILESTONE 6 DRAWS THE SAME LINE THROUGH MONEY IN. Recording a payment and the
 * whole promise workflow are the receptionist's; voiding a payment is the
 * manager's alone, again with no same-day window.
 */
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  MANAGER: PERMISSIONS,
  RECEPTIONIST: [
    'family.read',
    'family.create',
    'family.update',
    'family.update_status',
    'child.read',
    'child.create',
    'child.update',
    'child.update_status',

    // Milestone 4: choosing a service, a therapist and a room, seeing when that
    // therapist works and what the session costs, and running the diary. The
    // endpoints for the later lifecycle verbs arrive in the checkpoints that
    // build them; the authority is settled here.
    'therapist.read',
    'service.read',
    'room.read',
    'tariff.read',
    'availability.read',
    'appointment.read',
    'appointment.create',
    'appointment.update',
    'appointment.cancel',
    'appointment.complete',
    'appointment.override_availability',

    // Milestone 5: the receptionist reads the family account and raises the
    // charge for a session that happened, which is the ordinary end of
    // completing it. `charge.void` and `charge.adjust` stay with the manager —
    // withdrawing a charge or reducing one is a financial correction
    // PROJECT_SPEC.md 4 keeps away from this role, and granting it here would
    // reopen by the back door what withholding `appointment.reopen` closed
    // (DECISION_LOG, 2026-08-14 — Charge adjustment and void authority is
    // manager-only). There is no same-day window and no expiring authority.
    'charge.read',
    'charge.post',

    // Milestone 6: the receptionist takes the money and records the promise.
    // Recording a payment — including a prepayment, for which no approval
    // threshold exists (DECISION_LOG, 2026-08-15 — Credit is derived) — is the
    // counter work this role owns, and the whole promise workflow is theirs
    // because a promise moves no money in any state (CLAUDE.md).
    //
    // `payment.void` stays with the manager, with no same-day exception
    // (DECISION_LOG, 2026-08-15 — Payment void is manager-only): reversing a
    // financial record is the authority PROJECT_SPEC.md 4 keeps away from this
    // role, and granting it here would reopen by the back door what withholding
    // `charge.void` closed.
    'payment.read',
    'payment.create',
    'promise.read',
    'promise.create',
    'promise.resolve',
  ],
};

export function permissionsForRole(role: UserRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

/**
 * What reading a family account requires, ALL THREE OF THEM.
 *
 * The response is one screen and three authorities. It carries the charges and
 * their concessions (`charge.read`), and from Milestone 6 a whole-family
 * position stating what has been paid and what is due (`payment.read`) together
 * with the open and overdue promise counts (`promise.read`). A route that
 * demanded only the first would hand a caller two kinds of information its
 * permission never mentioned, and the permission model would describe the
 * product inaccurately — which is how a later role that should see charges but
 * not money quietly gets both.
 *
 * AND, NOT OR. `PermissionsGuard` requires every named permission, so a future
 * role holding one and not the others is refused rather than served a partial
 * account.
 *
 * IT CHANGES NO ACCESS TODAY: manager and receptionist both hold all three
 * (`ROLE_PERMISSIONS`), and a test pins that. It is a statement about what the
 * response contains, made before the response contains it.
 */
export const FAMILY_ACCOUNT_READ_PERMISSIONS = [
  'charge.read',
  'payment.read',
  'promise.read',
] as const satisfies readonly Permission[];
