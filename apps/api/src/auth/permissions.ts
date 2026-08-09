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
  ],
};

export function permissionsForRole(role: UserRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}
