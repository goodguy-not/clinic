-- Milestone 4, checkpoint A5: the instant a clinic day and a wall clock name.
--
-- Recurrence repeats a WALL-CLOCK TIME on a WEEKDAY, not an interval of
-- seconds. "Saturdays at ten" is the fact a family is told, and the second
-- occurrence is ten o'clock on the following Saturday — not the first instant
-- plus 604800 seconds. The two agree in Iran today, and they are still different
-- statements: one is a time somebody chose, the other is arithmetic on a
-- timestamp that would silently drift the hour if the zone's rules ever changed.
--
-- IT EXISTS SO `Asia/Tehran` STAYS WRITTEN IN ONE PLACE. `clinic_date` and
-- `clinic_clock_time` take an instant apart into a clinic day and a wall clock;
-- `clinic_day_start` puts a day back together at midnight. This is the general
-- case of the last one — a day and any time of day — and `clinic_day_start(d)`
-- is exactly `clinic_moment(d, '00:00')`. The earlier function is left alone:
-- it is what the day view's range predicate is written against, and rewriting a
-- working query to prove a point is not a reason to touch it.
--
-- `(day + wall_clock)::timestamp AT TIME ZONE 'Asia/Tehran'` reads as: take this
-- calendar day at this wall-clock time, interpret it in the clinic's zone, and
-- give me the instant it happened at.
--
-- STABLE and not IMMUTABLE, for the reason every other clinic-calendar function
-- here is: timezone definitions can change. It is therefore usable in a query
-- and not in a CHECK or an index expression, which no caller needs.
--
-- NOTHING ELSE IS ADDED BY THIS MIGRATION. No table, no column, no constraint,
-- no enum. The whole of recurrence — preview, series creation, cancel-from and
-- update-from — is written with the tables, CHECKs, exclusion constraints and
-- triggers the earlier Milestone 4 migrations already created: `appointment`
-- carries `series_id`, `appointment_series` carries the termination rule and
-- refuses to state two bounds, and the three conflicts are decided by exactly
-- the mechanisms a single booking is decided by. No financial column appears
-- here either; a series prices nothing.

CREATE OR REPLACE FUNCTION "clinic_moment"(day date, wall_clock time)
    RETURNS timestamptz LANGUAGE sql STABLE STRICT PARALLEL SAFE AS $fn$
    SELECT (day + wall_clock)::timestamp AT TIME ZONE 'Asia/Tehran';
$fn$;
