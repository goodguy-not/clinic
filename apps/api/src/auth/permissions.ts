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
 *
 * MILESTONE 8 ADDS SEVEN AND GRANTS THE RECEPTIONIST NONE OF THEM EITHER.
 * Therapist settlement — the share rules, the per-session ratings and the
 * period close — is the clinic's first authority over what a THERAPIST earns
 * rather than what a family owes, and PROJECT_SPEC.md 4 keeps clinic
 * configuration and financial correction with the manager. There is no
 * therapist-facing permission of any kind: a therapist has no account in this
 * product, so a name they could hold would describe a role that cannot log in.
 * The receptionist's list is therefore unchanged for the fourth milestone
 * running, and the test that states it exactly is what proves it.
 *
 * MILESTONE 9, CHECKPOINT A2 IS THE FIRST TIME THE RECEPTIONIST'S LIST HAS
 * GROWN SINCE MILESTONE 6, and it grows by exactly four names: `article.read`,
 * `article.draft`, `testimonial.read` and `testimonial.draft`. Somebody at the
 * front desk hears what families actually ask and is the right person to write
 * a first draft of an answer, so drafting public content is theirs — and
 * nothing they draft can reach a visitor, because `article.publish` and
 * `testimonial.approve` are withheld and the public reads return published
 * content only. That is the A1 promise kept in the role map rather than in a
 * comment: the permission that publishes is not the permission that writes, and
 * a test pins both halves.
 *
 * MILESTONE 9 ADDS THREE NAMES AND GRANTS THE RECEPTIONIST NONE OF THEM. The
 * public website is what the clinic says to people who are not its patients:
 * publishing a named colleague's photograph and biography
 * (`therapist.publish_profile`) and setting the address, telephone number and
 * links the site prints (`clinic_profile.read`, `clinic_profile.update`) are
 * manager authorities, and the checkpoint that let a receptionist DRAFT public
 * content reached none of them — draft authority does not imply publish
 * authority, which is why the A2 drafting names sit beside these three rather
 * than inside them.
 * The PUBLIC reads themselves hold no permission at all: they are classified
 * `internal`, reachable only across the internal-key boundary from the Next.js
 * server, and they can return nothing that is not already published.
 *
 * MILESTONE 9.5, CHECKPOINT A6 GROWS THE RECEPTIONIST'S LIST BY TWO, AND THE
 * FROZEN HALF IS THE HALF THAT DID NOT MOVE. `service.draft_public_copy` and
 * `therapist.draft_public_profile` let the front desk prepare public copy;
 * `service.update`, `service.update_status`, `therapist.update`,
 * `therapist.update_status`, `therapist.publish_profile`, `tariff.create`,
 * `tariff.void` and `availability.manage` are all exactly as withheld as they
 * were the day before. Durations, operational status, restrictions,
 * availability, tariffs, settlement configuration, personnel data and the
 * decision that a named colleague appears on a public website are untouched by
 * this checkpoint, and the test that states the receptionist's list exactly is
 * what proves a third name cannot arrive here without a decision.
 *
 * MILESTONE 7 ADDS TWO NAMES AND GRANTS THE RECEPTIONIST NEITHER. The
 * operational reads — the dashboard, the session report, the therapist activity
 * report, the promise report — are the diary, the ledger read and the promise
 * workflow this role already holds, read over a range instead of a day, so they
 * need no new authority and are granted none. `report.read_financial` is the
 * clinic's whole financial position and per-user attribution, and
 * `report.export` is carrying a file out of the system; both stay with the
 * manager. The dashboard is shared, and a caller without the first of those two
 * receives a response with no clinic-wide financial key at all.
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

    // Milestone 9, checkpoint A2: drafting public content, and reading the
    // drafts in order to edit them. NOT `article.publish` and NOT
    // `testimonial.approve` — a draft this role writes becomes visible to the
    // world only when a manager performs a separate, separately audited act,
    // and the public reads cannot return an unpublished row at all.
    //
    // `clinic_profile.read` is deliberately NOT here either. The address and
    // telephone number the site prints are not draftable content: there is one
    // profile, it is always live, and editing it IS publishing.
    'article.read',
    'article.draft',
    'testimonial.read',
    'testimonial.draft',

    // Milestone 9, checkpoint A4. The receptionist's list grows by two, and the
    // role map follows the WORK rather than the sensitivity of the data:
    // answering the clinic's contact form is front-desk work, exactly as the
    // telephone is, and a product in which only the manager could return a
    // parent's call is one in which nobody returns it. PROJECT_SPEC.md 4 keeps
    // configuration, financial correction and security administration from this
    // role; a message asking for a call back is none of those.
    //
    // `website_request.process` INCLUDES LINKING A REQUEST TO A FAMILY, which
    // this role can already do the harder half of — it registers families. The
    // link route additionally demands `family.read`, which it also holds.
    'website_request.read',
    'website_request.process',

    // Milestone 9.5, checkpoint A5. Three of the four media names, and the one
    // withheld is the one that makes a photograph visible. Photographing the new
    // therapy room and putting it on the draft list of clinic spaces is
    // front-desk work; deciding that the world may see it is not.
    // `media.publish` — which covers publishing an attachment, unpublishing one,
    // archiving an asset and restoring it — stays with the manager, exactly as
    // `article.publish` and `testimonial.approve` do, and for the same reason:
    // the permission that prepares a change is not the permission that moves the
    // page.
    //
    // NOTHING THESE THREE GRANT IS REACHABLE BY A VISITOR. An upload produces no
    // public byte, and an attachment is created unpublished with no field on the
    // request that could say otherwise, so the strongest thing a receptionist can
    // do here is present a manager with something ready to approve.
    'media.read',
    'media.upload',
    'media.attach',

    // Milestone 9.5, checkpoint A6. Two names, and they are the A2 drafting
    // authority extended to the two records that also have a public face: the
    // service description a family reads before ringing, and a colleague's
    // public display name, title and biography. The front desk hears what
    // families actually ask and is the right author of a first draft
    // (DECISION_LOG, 2026-09-08 — Editorial authority and operational authority
    // are split).
    //
    // NEITHER NAME WIDENS ANYTHING OPERATIONAL, AND THAT IS WHY THEY ARE NEW
    // NAMES RATHER THAN A GRANT OF `service.update` OR `therapist.update`.
    // Those two carry the durations, the active status, the room and service
    // restrictions and the specialty — configuration PROJECT_SPEC.md 4 keeps
    // with the manager — and this role still holds neither of them, which the
    // negative half of `permissions.spec.ts` states.
    //
    // NEITHER NAME PUBLISHES. Both write draft columns; every public read
    // selects the published ones; and the statements that copy one onto the
    // other are reachable only under `service.update` and
    // `therapist.publish_profile`, which stay with the manager. A receptionist
    // holding both of these still cannot change one word a visitor sees, and
    // still cannot put a named colleague on the website.
    'service.draft_public_copy',
    'therapist.draft_public_profile',
  ],
};

export function permissionsForRole(role: UserRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

/**
 * The authority sets a route names, re-exported rather than declared here.
 *
 * Milestone 7 adds three more of them — the dashboard's, the payments report's
 * and the family-accounts report's — for exactly the reason the family account's
 * moved: the page that renders each response has to demand what the route
 * demands, and one list stated in `@clinic/contracts` is the only way the two
 * cannot drift.
 */
export {
  DASHBOARD_READ_PERMISSIONS,
  PAYMENT_REPORT_READ_PERMISSIONS,
  FAMILY_ACCOUNT_REPORT_READ_PERMISSIONS,
} from '@clinic/contracts';

/**
 * The five export authorities, re-exported for the same reason and named on the
 * five C5 routes.
 *
 * Each is its report's READ list plus `report.export`, which is what makes the
 * receptionist's refusal a property of the permission model rather than of a
 * hidden control: they hold `appointment.read` and `promise.read`, they have
 * never held `report.export`, and `PermissionsGuard` therefore refuses them
 * every one of these routes before a statement runs.
 */
export {
  SESSION_REPORT_EXPORT_PERMISSIONS,
  PROMISE_REPORT_EXPORT_PERMISSIONS,
  THERAPIST_ACTIVITY_EXPORT_PERMISSIONS,
  PAYMENT_REPORT_EXPORT_PERMISSIONS,
  FAMILY_ACCOUNT_REPORT_EXPORT_PERMISSIONS,
} from '@clinic/contracts';

/**
 * What reading a family account requires, ALL THREE OF THEM.
 *
 * Re-exported rather than declared here, and the move is deliberate: the web
 * tier gates the page that renders this response and has to name the same three
 * authorities, so the list is stated once in `@clinic/contracts` where the
 * permission names already live. `PermissionsGuard` remains the authoritative
 * enforcement, and the ROLE map above stays in `apps/api` and nowhere else.
 *
 * `permissions.spec.ts` pins the three names and pins that both internal roles
 * hold all of them, so nobody's access changed when it moved.
 */
export { FAMILY_ACCOUNT_READ_PERMISSIONS } from '@clinic/contracts';

/**
 * The two Milestone 8 settlement authority sets, re-exported for the reason the
 * others are: the surfaces that call these routes have to demand exactly what
 * the routes demand, and one list stated in `@clinic/contracts` is the only way
 * the two cannot drift.
 *
 * `SETTLEMENT_EXPORT_PERMISSIONS` is the Milestone 7 export shape applied to the
 * settlement statement — the read AND `report.export`. `SETTLEMENT_RATING_
 * CORRECTION_PERMISSIONS` is the AND-list that exists because rating and
 * withdrawing a rating are two names: the atomic correction genuinely does both,
 * so it demands both.
 *
 * Neither grants anything. The manager holds every name in both; the
 * receptionist holds none of them, and `permissions.spec.ts` pins that.
 */
export {
  SETTLEMENT_EXPORT_PERMISSIONS,
  SETTLEMENT_RATING_CORRECTION_PERMISSIONS,
} from '@clinic/contracts';

/**
 * What linking a website request to a family requires: BOTH names.
 *
 * Re-exported for the reason the others are — the conversion screen has to
 * demand exactly what the route demands, and one list stated in
 * `@clinic/contracts` is the only way the two cannot drift.
 *
 * It grants nothing: manager and receptionist both hold `website_request.process`
 * and `family.read`, and `permissions.spec.ts` pins that.
 */
export { WEBSITE_REQUEST_LINK_PERMISSIONS } from '@clinic/contracts';
