-- Milestone 4, availability checkpoint: the integrity the availability rules
-- depend on.
--
-- NOTHING IN THE COMMITTED APPOINTMENT-SCHEMA MIGRATION IS ALTERED OR REWRITTEN.
-- The two availability tables were created there. This migration is the forward
-- correction to what that schema anticipated, applied the only way a committed
-- migration may be corrected: by a later one.
--
-- TWO DECISIONS ARE WRITTEN DOWN HERE.
--
-- FIRST, WHAT WAS DEFERRED: whether two working windows describing the same
-- hours are merged or refused. THEY ARE REFUSED. A therapist's week must have
-- exactly one reading; with two rows covering the same weekday and the same
-- hours, the one a booking check happens to read first decides. Merging on write
-- would be worse — it would silently rewrite what a manager typed.
--
-- Enforced in PostgreSQL rather than by reading before writing, for the reason
-- the tariff overlap constraints are: two concurrent replacements cannot both
-- pass a constraint, whatever the application checked first.
--
-- SECOND, WHAT WAS ANTICIPATED AND IS NOT APPROVED: effective-dated
-- availability. `effective_from` and `effective_to` were created for a
-- capability the milestone does not have, and this migration drops them. See the
-- section at the end for why they go rather than stay unused.

-- --- a range type over wall-clock time ---------------------------------------
--
-- PostgreSQL ships range types over dates and timestamps but not over `time`,
-- and an exclusion constraint needs one to ask whether two windows overlap.
-- Created here rather than in the schema file because Prisma cannot express a
-- range type; it is a database object like `fa_normalize` and the audit
-- triggers, and is asserted by name in an integration test.
--
-- Range types get GiST support generically, so no operator class has to be
-- named below.

CREATE TYPE "timerange" AS RANGE (subtype = time without time zone);

-- --- seconds are not part of a working hour ----------------------------------
--
-- The product contract is `HH:MM` (`clockTimeSchema`). A stored value carrying
-- seconds would still be a valid `time` and would be formatted back without
-- them, so the row and the response would quietly disagree. Refusing the write
-- is what keeps the round trip honest.

ALTER TABLE "therapist_availability" ADD CONSTRAINT "therapist_availability_time_precision_chk"
    CHECK (
        EXTRACT(SECOND FROM "start_time") = 0
        AND EXTRACT(SECOND FROM "end_time") = 0
    );

ALTER TABLE "therapist_availability_exception"
    ADD CONSTRAINT "therapist_availability_exception_time_precision_chk"
    CHECK (
        ("start_time" IS NULL OR EXTRACT(SECOND FROM "start_time") = 0)
        AND ("end_time" IS NULL OR EXTRACT(SECOND FROM "end_time") = 0)
    );

-- --- one reading per weekday -------------------------------------------------
--
-- Two windows conflict when they are the same therapist's, on the same weekday,
-- with overlapping hours. A morning block alongside an evening one is
-- legitimate, which is why this is an exclusion constraint and not a unique
-- index on the weekday.
--
-- Half-open hours (`[)`), so a window ending at 13:00 and one starting at 13:00
-- do not collide — back-to-back blocks are the normal shape of a clinic day, and
-- this matches the appointment overlap constraints.
--
-- THERAPIST, WEEKDAY AND HOURS, AND NOTHING ELSE. There is no date term because
-- there are no date columns left to range over — the section at the end of this
-- migration drops them. A date range here would make two windows with different
-- dates non-conflicting, which is precisely the effective-dated history this
-- milestone does not have.

ALTER TABLE "therapist_availability" ADD CONSTRAINT "therapist_availability_no_overlap_excl"
    EXCLUDE USING GIST (
        "therapist_id" WITH =,
        "weekday" WITH =,
        timerange("start_time", "end_time", '[)') WITH &&
    );

-- --- one reading per dated exception -----------------------------------------
--
-- TWO CONSTRAINTS, BECAUSE THE TWO KINDS OF EXCEPTION SAY DIFFERENT THINGS.
--
-- A closed day suspends the ordinary week for that date, and a date can be
-- suspended once or not at all — a partial unique index.
--
-- Extra windows are that date's own hours and may not overlap each other, the
-- same rule and the same half-open bounds as the recurring windows.
--
-- A CLOSED DAY AND AN EXTRA WINDOW ON ONE DATE ARE DELIBERATELY BOTH ALLOWED,
-- and the combination is the only way to express what a clinic says often: "not
-- my usual Saturday hours this week, but I will come in for 15:00 to 18:00."
-- Refusing it would leave that arrangement unrecordable — the closure alone
-- loses the afternoon, and the extra window alone leaves the standing morning
-- in force. The precedence is stated once, in `AvailabilityService.resolve`: a
-- closure suppresses the recurring week and nothing else.

CREATE UNIQUE INDEX "therapist_availability_exception_one_closure_idx"
    ON "therapist_availability_exception" ("therapist_id", "exception_date")
    WHERE ("is_available" = false);

ALTER TABLE "therapist_availability_exception"
    ADD CONSTRAINT "therapist_availability_exception_no_overlap_excl"
    EXCLUDE USING GIST (
        "therapist_id" WITH =,
        "exception_date" WITH =,
        timerange("start_time", "end_time", '[)') WITH &&
    ) WHERE ("is_available" = true);

-- --- dropping the effective-dating columns -----------------------------------
--
-- `therapist_availability` was created with `effective_from NOT NULL` and
-- `effective_to`, for effective-dated working hours: a window that starts
-- applying on a date and stops on another, with the superseded one still in the
-- table.
--
-- THAT CAPABILITY IS NOT APPROVED FOR THIS MILESTONE. Recurring availability is
-- CURRENT CONFIGURATION: the set says what is true now, a change is an edit to
-- the set, and what the set said before is history in `audit_log`. Dated facts
-- have their own table, `therapist_availability_exception`, and carry a single
-- date rather than a range.
--
-- The columns are dropped rather than left unused. An unused NOT NULL column
-- forces every writer to invent a value, and the sentinel it invents is a lie
-- that reads like data — the next person to see `effective_from = '1900-01-01'`
-- on every row has to discover from somewhere else that it means nothing. A
-- column that exists is also a column that a later checkpoint can start writing
-- to without anyone deciding it should, which is how an unapproved capability
-- arrives by accident. Nothing has read or written these columns outside this
-- checkpoint, and no row of real data exists in any environment, so there is
-- nothing to preserve and nothing to back-fill.
--
-- Forward-dated schedule changes remain a legitimate future feature. If they are
-- approved they arrive as a designed model with its own migration, its own
-- constraint and its own decision — not as two columns that happened to survive.
--
-- The CHECK goes first and explicitly. PostgreSQL would drop it along with the
-- columns it references, but a constraint disappearing as a side effect of a
-- column drop is exactly the kind of change that should be visible in a diff.

ALTER TABLE "therapist_availability"
    DROP CONSTRAINT "therapist_availability_effective_range_chk";

ALTER TABLE "therapist_availability" DROP COLUMN "effective_from";
ALTER TABLE "therapist_availability" DROP COLUMN "effective_to";
