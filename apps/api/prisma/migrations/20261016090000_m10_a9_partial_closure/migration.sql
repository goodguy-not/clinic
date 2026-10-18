-- Milestone 10, checkpoint A9 — A THERAPIST'S DAY CAN BE CLOSED IN PART.
--
-- Tour item T-012, owner-approved for the pilot: "leaves at 14:00" and "arrives
-- at 11:00" are recorded as a closure of one time range on one date, instead of
-- a whole-day closure with the remaining hours added back as an extra window.
--
-- NO NEW TABLE AND NO NEW COLUMN. A partial closure is the existing closure row
-- (`is_available = false`) carrying the two times it already had columns for.
-- Every existing row keeps its meaning: a closure without times is still the
-- whole day, an extra window is unchanged.
--
-- NOT DESTRUCTIVE. No row is changed or removed. One CHECK is widened, one
-- partial unique index is replaced by an exclusion constraint that refuses
-- everything the index refused and more, and one exclusion constraint is added.
-- Every existing database satisfies both new constraints, because before this
-- migration a closure carried no times and a date held at most one of them.
--
-- ROLLBACK CLASS: RESTORE (DEPLOYMENT_RUNBOOK 18.3). Nothing here rewrites data,
-- but it adds rules the previous release does not know: that release would read a
-- partial closure written on this one as a whole-day closure, would answer a
-- duplicate closure with a 500 instead of a conflict (it matches the old index,
-- which is gone), and would fail a write of an extra window over a partial
-- closure the same way. Going back therefore restores the backup taken when the
-- site closed.
--
-- Everything here is hand-written; Prisma cannot express a CHECK, a range or an
-- exclusion constraint, and the schema file is unchanged apart from comments.

-- --- a closure may carry a range ------------------------------------------------
--
-- Before: a closure carried no times, an extra window carried both. Now a closure
-- carries both or neither. "Both or neither, and the end after the start" is the
-- whole rule; a range that ends at or before its start, or names a time outside
-- the day, cannot be stored (`time` stops at 24:00, and the API's `HH:MM` stops
-- at 23:59).

ALTER TABLE "therapist_availability_exception"
    DROP CONSTRAINT "therapist_availability_exception_window_chk";

ALTER TABLE "therapist_availability_exception" ADD CONSTRAINT "therapist_availability_exception_window_chk"
    CHECK (
        ("is_available" = false AND "start_time" IS NULL AND "end_time" IS NULL)
        OR ("start_time" IS NOT NULL AND "end_time" IS NOT NULL AND "end_time" > "start_time")
    );

-- --- closures on one date may not overlap ---------------------------------------
--
-- The partial unique index said "a date is closed at most once". With ranges that
-- becomes "closures on one date may not overlap", and a whole-day closure is read
-- as [00:00, 24:00) so it overlaps every other closure of its date — including a
-- second whole-day closure, which is what the index refused.
--
-- OVERLAPPING CLOSURES ARE REFUSED, NOT MERGED (DECISION_LOG, 2026-10-16). Two
-- overlapping rows would be two answers to "why is this hour closed", and
-- removing one would silently reopen hours the other still meant to close. The
-- manager removes or narrows the first instead. Back-to-back ranges are allowed
-- (half-open bounds, as everywhere in availability) and read as one stretch.

DROP INDEX "therapist_availability_exception_one_closure_idx";

ALTER TABLE "therapist_availability_exception"
    ADD CONSTRAINT "therapist_availability_exception_closure_no_overlap_excl"
    EXCLUDE USING GIST (
        "therapist_id" WITH =,
        "exception_date" WITH =,
        timerange(
            COALESCE("start_time", TIME '00:00'),
            COALESCE("end_time", TIME '24:00'),
            '[)'
        ) WITH &&
    ) WHERE ("is_available" = false);

-- --- a partial closure and an extra window may not overlap ----------------------
--
-- A whole-day closure beside an extra window stays allowed: that pair is how "not
-- my usual hours, these instead" is recorded, and the resolution gives the window
-- precedence over the suspended week. A PARTIAL closure overlapping an extra
-- window has no such reading — one row says the therapist is here, the other that
-- they are not, for the same minutes — so it is refused whichever is written
-- second.
--
-- `is_available::int WITH <>` pairs a closure only with a window (btree_gist
-- supports `<>`), and the predicate leaves whole-day closures out, since they
-- carry no times.

ALTER TABLE "therapist_availability_exception"
    ADD CONSTRAINT "therapist_availability_exception_closure_window_excl"
    EXCLUDE USING GIST (
        "therapist_id" WITH =,
        "exception_date" WITH =,
        ("is_available"::int) WITH <>,
        timerange("start_time", "end_time", '[)') WITH &&
    ) WHERE ("start_time" IS NOT NULL);
