-- Milestone 4, booking checkpoint: the one approved override, recorded.
--
-- PROJECT_SPEC.md 5 states the rule this migration exists for: an
-- out-of-availability booking is "blocked or requires an authorized, recorded
-- override". This product does both — blocked by default, and permitted only to
-- a caller holding `appointment.override_availability`, who must say why.
--
-- THREE COLUMNS, NOT A BOOLEAN. A flag would record that a rule was set aside
-- without recording why, who or when, and a manual override that cannot be
-- explained is exactly what CLAUDE.md forbids. The reason is what the receptionist
-- and the manager read back; the actor and the instant are what an audit answers
-- with. They are stored on the row rather than left to `audit_log` alone because
-- an appointment list has to be able to show that a booking was an exception
-- without joining an append-only audit table into a read path.
--
-- WHY THEY ARE NULLABLE AND NOT DEFAULTED: the ordinary booking has no override,
-- and "no override" is the absence of the fact rather than an empty string. The
-- CHECK makes the three move together, so a half-recorded override cannot exist.
--
-- NOTHING ELSE IS ADDED. There is no override column for a therapist, room or
-- child conflict, and there must not be: a double-booked room is not a policy the
-- clinic may set aside, it is two sessions that cannot both happen. Those three
-- are hard blocks with no authorized path around them.
--
-- NO FINANCIAL COLUMN APPEARS HERE EITHER. No tariff reference, no price
-- snapshot, no charge, no discount, no amount. Pricing a session is Milestone 5's.
--
-- THIS MIGRATION IS ADDITIVE. Three nullable columns and one CHECK on an existing
-- table; every existing row satisfies the CHECK with three NULLs, so there is
-- nothing to back-fill and it cannot fail on existing data.

-- AlterTable
ALTER TABLE "appointment" ADD COLUMN     "availability_override_at" TIMESTAMPTZ,
ADD COLUMN     "availability_override_by_user_id" UUID,
ADD COLUMN     "availability_override_reason" TEXT;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_availability_override_by_user_id_fkey" FOREIGN KEY ("availability_override_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- HAND-WRITTEN — reviewed by a human, not generated.
-- ===========================================================================

-- --- an override is one fact, stated whole or not at all ---------------------
--
-- All three present, or all three absent. A reason with no actor would be an
-- unattributable exception; an actor with no reason would be the flag this
-- design rejects.
--
-- The text rules mirror `appointment_cancellation_consistency_chk` exactly: the
-- same trimming and the same 500-character bound, because both are the same kind
-- of value — a short recorded justification a person will read back.

ALTER TABLE "appointment" ADD CONSTRAINT "appointment_availability_override_chk"
    CHECK (
        (
            "availability_override_reason" IS NULL
            AND "availability_override_by_user_id" IS NULL
            AND "availability_override_at" IS NULL
        )
        OR (
            "availability_override_reason" IS NOT NULL
            AND "availability_override_by_user_id" IS NOT NULL
            AND "availability_override_at" IS NOT NULL
            AND "availability_override_reason" = btrim("availability_override_reason")
            AND btrim("availability_override_reason") <> ''
            AND length("availability_override_reason") <= 500
        )
    );

-- --- the start of a session is a minute, not a second ------------------------
--
-- The contract carries `startsAt` as an instant and the clinic's diary is read,
-- entered and printed in minutes. A start carrying seconds would produce an end
-- carrying them too, would make two "same time" appointments unequal, and would
-- put 09:00:30 in a column every interface formats as 09:00.
--
-- The service refuses one first and answers `APPOINTMENT_TIME_INVALID`, which is
-- the message a receptionist can act on. This is the second line: a data-fix
-- script or a psql session cannot write one either.
--
-- `ends_at` needs no rule of its own — `appointment_window_chk` already pins it
-- to `starts_at` plus a whole number of minutes.

ALTER TABLE "appointment" ADD CONSTRAINT "appointment_starts_at_precision_chk"
    CHECK (EXTRACT(SECOND FROM "starts_at") = 0);

-- --- clinic_clock_time: the wall-clock half of clinic_date -------------------
--
-- Availability is recorded as a weekday and two wall-clock times, and an
-- appointment is an instant. Deciding whether the instant falls inside the
-- window means reading the instant on the clinic's own clock, and that is the
-- same question `clinic_date` answers for the calendar day.
--
-- It exists so `Asia/Tehran` is written in ONE place in this system. The
-- appointment module needs both halves of the conversion; without this it would
-- carry the zone name itself, and the day somebody corrected one of the two
-- copies the booking rule would read a date from one timezone and a time from
-- another.
--
-- `HH24:MI`, matching `clockTimeSchema` exactly: fixed width, no seconds, so
-- string comparison against a stored window is chronological comparison.
--
-- STABLE and not IMMUTABLE, for the reason `clinic_date` is: timezone
-- definitions can change. It is therefore usable in a query and not in a CHECK,
-- which is why availability containment is a service-layer decision.
CREATE OR REPLACE FUNCTION "clinic_clock_time"(moment timestamptz)
    RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $fn$
    SELECT to_char(moment AT TIME ZONE 'Asia/Tehran', 'HH24:MI');
$fn$;

-- --- the index the child-overlap recomputation reads -------------------------
--
-- "Does this child already have a session overlapping this window?" is answered
-- by joining `appointment_participant` to `appointment` under an advisory lock on
-- the child. The seat side already has `appointment_participant_child_id_idx`;
-- this is the appointment side of the same question, narrowed to the two statuses
-- that occupy time, so a cancelled booking is not even a row the check has to
-- discard.
--
-- Partial on the same predicate as the two exclusion constraints, so all three
-- conflict rules read the same definition of "occupies the slot".

CREATE INDEX "appointment_occupying_window_idx"
    ON "appointment" ("id", "starts_at", "ends_at")
    WHERE ("status" IN ('SCHEDULED', 'COMPLETED'));
