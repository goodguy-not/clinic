-- Milestone 9, checkpoint A3 — the public request form, and the FIRST TABLE IN
-- THIS SCHEMA A STRANGER CAN WRITE TO.
--
-- A1 gave the clinic a public face and A2 gave it a voice. This migration adds
-- the one thing the world may say BACK: a parent who has read a page, wants
-- somebody to telephone them, and is not — yet, and possibly ever — a family in
-- this system.
--
-- ONE TABLE. No inbox table, no status table, no assignment, no conversation
-- thread, no reply, no attachment, no tag, no queue and no analytics. A request
-- is a message somebody left; the workflow over it is checkpoint A4 and is
-- deliberately absent here.
--
-- ============================== THE RETENTION ===============================
--
-- THE ROW IS NEVER DELETED. THE CONTENT IS ERASED IN PLACE.
--
-- This table carries the same `no_delete` and `no_truncate` triggers as every
-- other historical table in this schema, and the accepted Milestone 9 retention
-- rule is satisfied by an UPDATE rather than by a DELETE: after ninety days the
-- intake columns are CLEARED and a MINIMAL LIFECYCLE ROW remains — the id, when
-- the request arrived, the consent evidence, and `purged_at`.
--
-- THOSE TWO RULES ARE NOT IN TENSION, AND IT IS WORTH SAYING WHY. What the
-- clinic promised the submitter is that it will not keep their NAME, their
-- TELEPHONE NUMBER and what they wrote about their child. It did not promise to
-- forget that a request arrived, and forgetting that would be worse than
-- useless: the lifecycle row is what lets anybody afterwards say how many
-- requests came in, how many became families, and that this particular one was
-- dealt with rather than quietly dropped. Erasing the row outright would also
-- mean a routine job holding a real DELETE grant on a table full of personal
-- data — precisely the operation this schema refuses everywhere else, and
-- precisely the one whose blast radius nobody can bound in advance.
--
-- `purged_at` IS WHAT MAKES BOTH INVARIANTS ENFORCEABLE AT ONCE. While it is
-- NULL the four required intake columns are NOT NULL, so "the contract's
-- required fields are required" stays a DATABASE guarantee rather than a
-- service-layer promise. Once it is set, every purgeable column must be NULL —
-- a half-purged row is refused as firmly as a content-less live one.
-- `website_request_purge_chk` states exactly that, in both directions, and it is
-- the reason the intake columns are nullable at all: nullability here is the
-- ERASURE, never the contract.
--
-- A3 ADDS THE SHAPE, NOT THE POLICY. Nothing in this checkpoint sets
-- `purged_at`, and there is no schedule, no CLI and no ninety-day arithmetic
-- anywhere in it. A4 owns when a request is purged and what closes it; what A3
-- owes is a table on which that can be an UPDATE.
--
-- WHAT SURVIVES IN `audit_log` IS THE ACT AND NEVER THE CONTENT. The audit row
-- for a submission records that one arrived, when, and under which id. It
-- records NO name, NO mobile, NO child name, NO age, NO sex, NO service, NO
-- note, NO contact preference and NO abuse-control identifier — and no raw IP or
-- user agent either, which every other audited write in this application does
-- carry. `audit_log` is append-only and unprunable, so anything copied into it
-- from this table would become a SECOND, PERMANENT copy of exactly the personal
-- data the erasure exists to remove. This row holds the content and can be
-- emptied; the permanent store holds the act and never held the content. That
-- asymmetry is the whole privacy design of this checkpoint.
--
-- ============================== THE IDENTITY ================================
--
-- NO `family_id` AND NO `child_id`, AND NEITHER IS PENDING. A stranger who
-- fills in a form has not become a clinic record; a member of staff decides
-- that, later, in the conversion path A4 owns. Because there is no column, there
-- is no anonymous path through this application that can create or mutate a
-- family — not a rule a service enforces, an absence the schema does.
--
-- ============================ THE ABUSE CONTROLS ============================
--
-- `submitter_fingerprint` AND `dedupe_key` ARE KEYED HASHES, AND NEITHER RAW
-- VALUE IS STORED ANYWHERE. The first is derived from the caller's IP address —
-- which appears in no column of this table and in no audit payload — and the
-- second from the submission itself. Both are HMAC-SHA-256 under a key the
-- server derives and never writes down, because an UNKEYED hash would be
-- reversible by anybody holding a database dump: four billion guesses for an
-- IPv4 address, and fewer than that for an Iranian mobile number.
--
-- Both are purgeable, and both may ALSO be cleared on their own ahead of the
-- purge: they stop being useful long before the request does.
--
-- There is NO CAPTCHA column, NO score, NO bot verdict and NO third-party
-- identifier: the accepted product posture for M9 is proportionate,
-- self-contained abuse control with no external anti-bot service.
--
-- ============================== THE AGE BOUND ===============================
--
-- `website_request_child_age_chk` IS A SANITY BOUND AND CARRIES NO CLINIC
-- POLICY. Zero to one hundred and twenty is the bound of a human lifetime,
-- chosen precisely because it decides nothing. Any narrower number would be this
-- clinic refusing to hear from somebody on the basis of their age, written into
-- a CHECK constraint where nobody would find it and nobody approved it. Who the
-- clinic can help is a conversation a colleague has, not a constraint violation
-- a stranger receives.
--
-- ===================== THE PREFERRED CONTACT TIME ==========================
--
-- FOUR VALUES IN A POSTGRESQL ENUM, OWNER-APPROVED AND FROZEN, AND NOT ONE CLOCK
-- TIME AMONG THEM.
--
-- `website_request_contact_time` is MORNING, AFTERNOON, EVENING and
-- NO_PREFERENCE. It expresses a parent's preference and NOTHING ELSE: it is not
-- an SLA, not a promise that the clinic will call in that period, and not a
-- commitment of any kind. Nothing in this application schedules, queues,
-- reminds, prioritises or measures anything from this column, and the product
-- would behave identically if every row carried the same value.
--
-- NO RANGES ARE ATTACHED TO THESE, HERE OR ANYWHERE. `MORNING` is not
-- 08:00-12:00. Times behind these names would be a second, quieter answer to
-- "when is the clinic open?" living in the schema — one the real opening hours
-- in `clinic_public_profile` could contradict — and would turn a parent's rough
-- preference into a figure somebody could hold the clinic to. Deriving clinic
-- hours FROM them is equally wrong: they say when a PARENT is free, which is not
-- a fact about the clinic.
--
-- AN ENUM RATHER THAN THE BOUNDED TEXT THIS COLUMN CARRIED IN THE FIRST A3
-- DRAFT. A colleague scanning the inbox A4 builds needs a value they can sort
-- and filter by, not a sentence somebody has to read and interpret — which is
-- exactly the reason `child_sex` is an enum. `NO_PREFERENCE` is a real answer,
-- and the column is ALSO nullable: "any time suits us" is what a parent said,
-- NULL is a form that did not ask, and the two are different facts.
--
-- The section above the "HAND-WRITTEN" banner is generated by Prisma.
-- Everything below it is reviewed by a human. Each hand-written object is
-- named, and `website-request-schema.int-spec.ts` asserts every name exists in
-- the PostgreSQL catalogue, so a future edit cannot quietly drop one.

-- CreateEnum
CREATE TYPE "website_request_contact_time" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING', 'NO_PREFERENCE');

-- CreateTable
CREATE TABLE "website_request" (
    "id" UUID NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contact_name" TEXT,
    "contact_mobile" TEXT,
    "requested_service_id" UUID,
    "child_name" TEXT,
    "child_age_years" SMALLINT,
    "child_sex" "child_sex",
    "preferred_contact_time" "website_request_contact_time",
    "note" TEXT,
    "consent_given" BOOLEAN NOT NULL,
    "consent_version" TEXT NOT NULL,
    "consent_recorded_at" TIMESTAMPTZ NOT NULL,
    "submitter_fingerprint" TEXT,
    "dedupe_key" TEXT,
    "purged_at" TIMESTAMPTZ,

    CONSTRAINT "website_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "website_request_submitter_fingerprint_received_at_idx" ON "website_request"("submitter_fingerprint", "received_at");

-- CreateIndex
CREATE INDEX "website_request_dedupe_key_received_at_idx" ON "website_request"("dedupe_key", "received_at");

-- AddForeignKey
ALTER TABLE "website_request" ADD CONSTRAINT "website_request_requested_service_id_fkey" FOREIGN KEY ("requested_service_id") REFERENCES "service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- HAND-WRITTEN: everything below this line is reviewed, not generated.
-- ===========================================================================

-- --- THE RETENTION INVARIANT, IN ONE CONSTRAINT ----------------------------
--
-- Read it as two sentences.
--
-- WHILE THE CONTENT IS HELD (`purged_at IS NULL`) the four required intake
-- columns are present. This is what keeps "required means required" a database
-- guarantee even though every one of these columns is nullable: nullability is
-- the erasure, not the contract, and no INSERT — service, data fix or psql
-- prompt — can create a live request with no name, no number, no age or no sex.
--
-- ONCE THE CONTENT IS ERASED (`purged_at IS NOT NULL`) every purgeable column is
-- absent. A HALF-PURGED ROW IS REFUSED AS FIRMLY AS A CONTENT-LESS LIVE ONE,
-- which is the half that matters: a retention run that cleared the name and left
-- the telephone number would otherwise look like it had worked.
--
-- What is deliberately NOT purgeable, and therefore not named here: the id, the
-- arrival instant, and the three consent columns. None of them is personal data
-- and together they are the minimal lifecycle row — enough to say that a
-- consented request arrived on a day and was dealt with, and not enough to say
-- anything about anybody.
ALTER TABLE "website_request" ADD CONSTRAINT "website_request_purge_chk"
    CHECK (
        ("purged_at" IS NULL) = ("contact_name" IS NOT NULL)
        AND ("purged_at" IS NULL) = ("contact_mobile" IS NOT NULL)
        AND ("purged_at" IS NULL) = ("child_age_years" IS NOT NULL)
        AND ("purged_at" IS NULL) = ("child_sex" IS NOT NULL)
        AND ("purged_at" IS NULL OR "child_name" IS NULL)
        AND ("purged_at" IS NULL OR "preferred_contact_time" IS NULL)
        AND ("purged_at" IS NULL OR "note" IS NULL)
        AND ("purged_at" IS NULL OR "requested_service_id" IS NULL)
        AND ("purged_at" IS NULL OR "submitter_fingerprint" IS NULL)
        AND ("purged_at" IS NULL OR "dedupe_key" IS NULL)
    );

-- --- what the visitor typed -------------------------------------------------
--
-- Trimmed, bounded, and free of markup, exactly as A2's public copy is. The
-- markup rule is here for the OPPOSITE reason, though, and it is worth stating:
-- A2 refuses `<` in text a MANAGER writes and a STRANGER reads; this refuses it
-- in text a STRANGER writes and a COLLEAGUE reads. The second direction is the
-- hostile one, and the answer is the same — there is no markup to sanitise, so
-- the inbox A4 builds needs no sanitiser and has none to misconfigure.
--
-- Every one of these tolerates NULL, because every one of them is erased by the
-- purge. Which of them may be NULL WHEN, and only then, is
-- `website_request_purge_chk` above.

ALTER TABLE "website_request" ADD CONSTRAINT "website_request_contact_name_chk"
    CHECK (
        "contact_name" IS NULL
        OR (
            "contact_name" = btrim("contact_name")
            AND btrim("contact_name") <> ''
            AND length("contact_name") <= 120
            AND position('<' IN "contact_name") = 0
        )
    );

-- The canonical national form every mobile column in this schema uses. An
-- international number, a Persian-digit number or a spaced one is folded by the
-- web tier long before it reaches here; what this column holds is one shape.
ALTER TABLE "website_request" ADD CONSTRAINT "website_request_contact_mobile_chk"
    CHECK ("contact_mobile" IS NULL OR "contact_mobile" ~ '^09[0-9]{9}$');

ALTER TABLE "website_request" ADD CONSTRAINT "website_request_child_name_chk"
    CHECK (
        "child_name" IS NULL
        OR (
            "child_name" = btrim("child_name")
            AND btrim("child_name") <> ''
            AND length("child_name") <= 120
            AND position('<' IN "child_name") = 0
        )
    );

-- A SANITY BOUND, NOT AN ELIGIBILITY RULE. See the banner above.
ALTER TABLE "website_request" ADD CONSTRAINT "website_request_child_age_chk"
    CHECK ("child_age_years" IS NULL OR "child_age_years" BETWEEN 0 AND 120);

-- `preferred_contact_time` NEEDS NO CHECK AND HAS NONE. It is a PostgreSQL enum
-- (see the banner above), so the type itself refuses anything outside the four
-- approved values — including the free text this column accepted in the first A3
-- draft. There is nothing left for a constraint to add.

ALTER TABLE "website_request" ADD CONSTRAINT "website_request_note_chk"
    CHECK (
        "note" IS NULL
        OR (
            "note" = btrim("note")
            AND btrim("note") <> ''
            AND length("note") <= 2000
            AND position('<' IN "note") = 0
        )
    );

-- --- the consent evidence ---------------------------------------------------
--
-- THE ROW CANNOT EXIST WITHOUT CONSENT, AND THE PURGE DOES NOT CHANGE THAT.
-- `consent_given` is not a flag a reader has to check: a FALSE row is refused by
-- the database, so "every stored request was consented to" is a property of the
-- table rather than of whichever code path happened to insert. All three columns
-- survive the erasure, because none of them says anything about anybody — and a
-- lifecycle row that could not say the request had been consented to would be a
-- worse record than none.
--
-- The version is REQUIRED and bounded, because a recorded consent whose terms
-- nobody can name is not evidence. The wording it names is owner-supplied and
-- lives in the web tier beside the checkbox; the shared contract freezes the set
-- of version identifiers, so a stored version is one BOTH tiers agreed to before
-- the submission happened rather than a string a caller invented.
ALTER TABLE "website_request" ADD CONSTRAINT "website_request_consent_chk"
    CHECK (
        "consent_given" IS TRUE
        AND "consent_version" = btrim("consent_version")
        AND btrim("consent_version") <> ''
        AND length("consent_version") <= 40
    );

-- --- the abuse-control identifiers ------------------------------------------
--
-- Both are hexadecimal HMAC-SHA-256 digests or nothing at all. The shape check
-- is what keeps a raw IP address or a raw mobile number from ever being written
-- into either column by a hand-written INSERT, a data fix or a future service
-- that forgot which value it was holding: neither raw value can match sixty-four
-- hexadecimal characters.

ALTER TABLE "website_request" ADD CONSTRAINT "website_request_submitter_fingerprint_chk"
    CHECK ("submitter_fingerprint" IS NULL OR "submitter_fingerprint" ~ '^[0-9a-f]{64}$');

ALTER TABLE "website_request" ADD CONSTRAINT "website_request_dedupe_key_chk"
    CHECK ("dedupe_key" IS NULL OR "dedupe_key" ~ '^[0-9a-f]{64}$');

-- --- the row is never rewritten, and is only ever emptied -------------------
--
-- A request is a RECORD OF WHAT SOMEBODY SAID, and nobody at the clinic may edit
-- it into something they did not say. There is no correction path, no amendment
-- and no staff edit anywhere in the product: a colleague who learns more picks up
-- the telephone and writes it down in a family record.
--
-- The trigger permits exactly two kinds of change, and NEITHER OF THEM IS AN
-- EDIT:
--
--   * CLEARING a purgeable column to NULL. That is the ninety-day erasure, and
--     also the narrower cleanup that ages out the two abuse-control identifiers
--     ahead of it.
--   * STAMPING `purged_at` once, from NULL. It can never be rewritten and can
--     never be cleared: an erasure that could be un-declared would let the row
--     claim the content is still held when it is gone.
--
-- Everything else is refused. Not the id, not the arrival instant, not the
-- consent, and not any purgeable column's value being CHANGED rather than
-- removed — which is the case that would otherwise let a purge be turned into a
-- rewrite, and the reason this is a trigger rather than a column-level grant.
--
-- A4 will need a status column and a family link, and it will add them WITH the
-- rule that lets them move — a decision taken with the inbox in front of it
-- rather than an allowance made here for a workflow nobody has designed.
CREATE OR REPLACE FUNCTION "enforce_website_request_immutable"() RETURNS trigger AS $$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."received_at" IS DISTINCT FROM OLD."received_at"
       OR NEW."consent_given" IS DISTINCT FROM OLD."consent_given"
       OR NEW."consent_version" IS DISTINCT FROM OLD."consent_version"
       OR NEW."consent_recorded_at" IS DISTINCT FROM OLD."consent_recorded_at" THEN
        RAISE EXCEPTION
            'website_request records what a visitor submitted and is never edited'
            USING ERRCODE = '23001';
    END IF;

    -- Every purgeable column: removable, never changeable. A NULL that becomes a
    -- value is as refused as a value that becomes a different value, so nothing
    -- can be written back into a row after it has been erased.
    IF (NEW."contact_name" IS DISTINCT FROM OLD."contact_name" AND NEW."contact_name" IS NOT NULL)
       OR (NEW."contact_mobile" IS DISTINCT FROM OLD."contact_mobile"
           AND NEW."contact_mobile" IS NOT NULL)
       OR (NEW."requested_service_id" IS DISTINCT FROM OLD."requested_service_id"
           AND NEW."requested_service_id" IS NOT NULL)
       OR (NEW."child_name" IS DISTINCT FROM OLD."child_name" AND NEW."child_name" IS NOT NULL)
       OR (NEW."child_age_years" IS DISTINCT FROM OLD."child_age_years"
           AND NEW."child_age_years" IS NOT NULL)
       OR (NEW."child_sex" IS DISTINCT FROM OLD."child_sex" AND NEW."child_sex" IS NOT NULL)
       OR (NEW."preferred_contact_time" IS DISTINCT FROM OLD."preferred_contact_time"
           AND NEW."preferred_contact_time" IS NOT NULL)
       OR (NEW."note" IS DISTINCT FROM OLD."note" AND NEW."note" IS NOT NULL)
       OR (NEW."submitter_fingerprint" IS DISTINCT FROM OLD."submitter_fingerprint"
           AND NEW."submitter_fingerprint" IS NOT NULL)
       OR (NEW."dedupe_key" IS DISTINCT FROM OLD."dedupe_key" AND NEW."dedupe_key" IS NOT NULL) THEN
        RAISE EXCEPTION
            'website_request content may only be cleared, never rewritten'
            USING ERRCODE = '23001';
    END IF;

    IF OLD."purged_at" IS NOT NULL AND NEW."purged_at" IS DISTINCT FROM OLD."purged_at" THEN
        RAISE EXCEPTION
            'website_request.purged_at is written once and never rewritten or cleared'
            USING ERRCODE = '23001';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "website_request_immutable"
    BEFORE UPDATE ON "website_request"
    FOR EACH ROW EXECUTE FUNCTION "enforce_website_request_immutable"();

-- --- no deletion, no truncation (reuses the Milestone 1 shared function) ----
--
-- THE CONVENTION APPLIES HERE UNCHANGED, and the earlier A3 draft that omitted
-- these two was wrong: it read "the content must be erasable" as "the row must be
-- removable", which are different requirements with very different blast radii.
-- Erasure is the UPDATE above. This is what stops anybody — a retention run with
-- a mistaken predicate, a data fix, a stray statement at a psql prompt — from
-- destroying the lifecycle record along with the content.
--
-- The TRUNCATE trigger is not optional, for the reason `audit_log`'s is not:
-- TRUNCATE bypasses row-level triggers entirely, so without it the whole
-- guarantee would be one statement away from gone.

CREATE TRIGGER "website_request_no_delete"
    BEFORE DELETE ON "website_request"
    FOR EACH ROW EXECUTE FUNCTION "raise_append_only_violation"();

CREATE TRIGGER "website_request_no_truncate"
    BEFORE TRUNCATE ON "website_request"
    FOR EACH STATEMENT EXECUTE FUNCTION "raise_append_only_violation"();
