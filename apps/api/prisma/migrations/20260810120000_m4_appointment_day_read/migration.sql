-- Milestone 4, checkpoint A4: the instant a clinic day begins.
--
-- The single-day read model asks "every appointment on this clinic date". The
-- obvious spelling — `WHERE clinic_date(starts_at) = $1` — is correct and
-- unindexable: `clinic_date` is STABLE and applied per row, so the day view of a
-- clinic with three years of history scans every appointment ever booked.
--
-- This is the same question asked from the other side. A day is the half-open
-- instant range `[clinic_day_start(d), clinic_day_start(d + 1))`, both ends are
-- constants for the query, and the planner can use
-- `appointment_starts_at_idx` on `starts_at` directly.
--
-- IT EXISTS SO `Asia/Tehran` STAYS WRITTEN IN ONE PLACE. `clinic_date` and
-- `clinic_clock_time` already convert an instant to the clinic's calendar day
-- and wall clock; this converts a calendar day back to the instant it starts.
-- Without it the appointment module would carry the zone name itself, and the
-- day somebody corrected one copy the read model would disagree with the rule
-- that decided availability.
--
-- HALF-OPEN, AND NEVER `+ interval '1 day' - 1 second`. Midnight belongs to the
-- day that starts, not to the one that ends, and an appointment at exactly
-- 00:00 must appear once. `[)` is also the bound the two exclusion constraints
-- and the child-overlap recomputation already use, so every range in this
-- milestone is read the same way.
--
-- `d::timestamp AT TIME ZONE 'Asia/Tehran'` reads as: take midnight on this
-- calendar day, interpret it as a Tehran wall-clock time, and give me the
-- instant. Iran has had no DST since 1401, and if that changed this is where
-- the change would be handled once rather than in every caller.
--
-- STABLE and not IMMUTABLE, for the reason `clinic_date` is: timezone
-- definitions can change. It is therefore usable in a query and not in a CHECK
-- or an index expression — which is why the day view is a range predicate over
-- a plain column rather than an expression index.
--
-- NOTHING ELSE IS ADDED BY THIS MIGRATION. No table, no column, no constraint:
-- the appointment lifecycle this checkpoint completes — move, cancel, complete,
-- attendance, reopen — is written entirely with the columns, CHECKs, exclusion
-- constraints and triggers the earlier Milestone 4 migrations already created,
-- and needed none of them changed. No financial column appears here either;
-- the tariff suggestion the read model computes is a lookup against the
-- existing `tariff` table and is stored nowhere.

CREATE OR REPLACE FUNCTION "clinic_day_start"(day date)
    RETURNS timestamptz LANGUAGE sql STABLE STRICT PARALLEL SAFE AS $fn$
    SELECT day::timestamp AT TIME ZONE 'Asia/Tehran';
$fn$;
