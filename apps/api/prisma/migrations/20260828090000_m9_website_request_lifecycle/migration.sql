-- Milestone 9, checkpoint A4 — what the clinic DOES with a stranger's message.
--
-- A3 accepted the message and stopped, deliberately: it added a table a visitor
-- can write to and refused to invent the workflow over it. This migration is
-- that workflow, and it is five statuses, one family link and one erasure
-- deadline. NOTHING ELSE.
--
-- NO INBOX TABLE, NO ASSIGNMENT, NO REMINDER, NO NOTE THREAD, NO REPLY, NO TAG,
-- NO PRIORITY, NO QUEUE AND NO ANALYTICS ROLLUP. PROJECT_SPEC.md 11 lists the
-- five statuses and then says "this is not a full CRM"; the second sentence is
-- as binding as the first, and every column below is one the ninety-day
-- retention rule or the conversion path actually needs.
--
-- ========================== WHAT A4 MAY NOT UNDO ============================
--
-- Every A3 guarantee survives this migration unchanged. The row is still never
-- deleted or truncated; the intake columns are still write-once-then-clearable;
-- `purged_at` is still stamped once and never rewritten; the consent evidence is
-- still immutable; and no raw IP address or user agent exists in any column.
-- This migration ADDS to `enforce_website_request_immutable` and ADDS a second
-- CHECK beside `website_request_purge_chk`. It rewrites neither, because A3's
-- accepted facts are not A4's to restate.
--
-- ============================ THE FIVE STATUSES =============================
--
-- A POSTGRESQL ENUM, so "only accepted statuses can exist" is a property of the
-- type rather than of whichever code path last wrote a row.
--
-- `NEW` IS THE ARRIVAL STATE AND NOTHING RETURNS TO IT. It means "nobody at the
-- clinic has touched this yet", which stops being true the moment somebody does.
-- A status that could be restored would let the inbox claim a request had never
-- been looked at, which is exactly the claim the inbox exists to make honestly.
--
-- `CONTACTED` AND `FOLLOW_UP_NEEDED` MOVE FREELY IN BOTH DIRECTIONS. Ring, leave
-- a message, mark it for another try, ring again. Neither schedules anything,
-- neither is a queue, and nothing in this application reads either one.
--
-- `CONVERTED_TO_FAMILY` AND `CLOSED` ARE BOTH TERMINAL (the accepted A4 owner
-- decision). The reason is in the retention rule and is worth stating plainly:
-- the erasure runs ninety days after CLOSURE, so if a closure could be undone
-- the deadline could be postponed for ever by anybody holding an UPDATE, and
-- "this has been closed for ninety days" would stop being a fact this database
-- can hold. The cost was accepted with the decision — a request closed by
-- mistake is not reopened here. The colleague telephones the family and writes
-- what they learn in the family record, which is where the clinic's own version
-- of a conversation belongs in any case.
--
-- A MOVE TO THE STATUS A REQUEST IS ALREADY IN IS REFUSED TOO. Status changes
-- carry no free-text reason in M9, so re-recording the current status would
-- write an audit row that says nothing and move nothing.
--
-- ============================== THE FAMILY LINK =============================
--
-- `linked_family_id` IS THE COLUMN A3 SAID IT DID NOT HAVE, ADDED WITH THE
-- DECISION RATHER THAN AHEAD OF IT.
--
-- A3's argument was that no anonymous path could create or mutate a family
-- because no column existed through which one could. That argument is preserved
-- exactly, and it is worth being precise about how: the anonymous submission
-- path still writes NOTHING here — it inserts a row with the default `NEW`
-- status and three NULLs — and this column is written only by a signed-in
-- colleague holding `website_request.process`, naming a family that ALREADY
-- EXISTS. Creating a family from a request is still the ordinary registration
-- workflow, with its ordinary duplicate detection and its ordinary
-- `family.create` authority; the request is linked afterwards, by the same
-- route, and there is deliberately no second family-creation path anywhere.
--
-- THERE IS STILL NO `child_id`, AND THERE IS STILL NO BIRTH DATE. A request
-- carries a child's age in WHOLE YEARS as a parent typed it — a staff-triage
-- fact and, as A3 said, nothing this application decides anything from. A child
-- record carries a DATE OF BIRTH somebody at the clinic confirmed. Deriving the
-- second from the first would put a wrong, authoritative-looking date on a
-- permanent record, and no column here invites it.
--
-- AT MOST ONE FAMILY, EVER. One nullable column is the shape of that rule; the
-- immutability trigger makes it write-once, so a link cannot be quietly
-- re-pointed at a different family afterwards. A link is a claim about whose
-- message this was, and correcting it silently would rewrite that claim.
--
-- ========================= THE RETENTION DEADLINE ===========================
--
-- `website_request_purge_eligibility_chk` IS THE ACCEPTED NINETY-DAY POLICY
-- WRITTEN AS A CONSTRAINT RATHER THAN AS A PREDICATE THE RETENTION RUN IS
-- TRUSTED TO REMEMBER.
--
-- A row may be purged only if it is CLOSED, only if it was never linked to a
-- family, and only ninety days or more after its closure. All three are enforced
-- by the database, so a retention run with a mistaken predicate — or a
-- hand-written UPDATE at a psql prompt — cannot erase a request that is still
-- being worked on, cannot erase a family's history, and cannot erase anything
-- early. The run itself repeats the same three conditions in its WHERE clause;
-- this is what makes the repetition harmless rather than the only defence.
--
-- WHY NINETY DAYS IS IN THE SCHEMA AND NOT ONLY IN THE CODE. The interval is the
-- accepted policy and changing it is a decision, not a deployment: putting it in
-- a CHECK means shortening it requires a migration somebody reviews, and
-- lengthening it does too. A run that tried to erase sooner is a constraint
-- violation, which is a loud failure rather than a quiet over-collection.
--
-- The section above the "HAND-WRITTEN" banner is generated by Prisma.
-- Everything below it is reviewed by a human. Each hand-written object is
-- named, and `website-request-schema.int-spec.ts` asserts every name exists in
-- the PostgreSQL catalogue, so a future edit cannot quietly drop one.

-- CreateEnum
CREATE TYPE "website_request_status" AS ENUM ('NEW', 'CONTACTED', 'FOLLOW_UP_NEEDED', 'CONVERTED_TO_FAMILY', 'CLOSED');

-- AlterTable
ALTER TABLE "website_request" ADD COLUMN     "closed_at" TIMESTAMPTZ,
ADD COLUMN     "linked_at" TIMESTAMPTZ,
ADD COLUMN     "linked_by_user_id" UUID,
ADD COLUMN     "linked_family_id" UUID,
ADD COLUMN     "status" "website_request_status" NOT NULL DEFAULT 'NEW',
ADD COLUMN     "status_changed_at" TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX "website_request_status_received_at_idx" ON "website_request"("status", "received_at");

-- AddForeignKey
ALTER TABLE "website_request" ADD CONSTRAINT "website_request_linked_family_id_fkey" FOREIGN KEY ("linked_family_id") REFERENCES "family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "website_request" ADD CONSTRAINT "website_request_linked_by_user_id_fkey" FOREIGN KEY ("linked_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- HAND-WRITTEN: everything below this line is reviewed, not generated.
-- ===========================================================================

-- --- the lifecycle timestamps say exactly what the status says ---------------
--
-- Three biconditionals, and each one closes a way for the row to lie about
-- itself.
--
-- `status_changed_at` IS ABSENT EXACTLY WHILE THE STATUS IS `NEW`. Untouched and
-- never-moved are the same fact, so they are stored as the same fact; a `NEW`
-- request carrying a change instant would be one that had been moved back, which
-- the transition trigger refuses anyway.
--
-- `closed_at` IS PRESENT EXACTLY WHEN THE STATUS IS `CLOSED`. This is the column
-- the retention deadline is measured from, so a closed request without one would
-- be a request that could never be erased, and an unclosed request with one would
-- be a request that could be erased while somebody was still working on it.
--
-- THE THREE LINK COLUMNS ARE ALL PRESENT OR ALL ABSENT. A link records who tied
-- this message to that family and when; two of the three would be a record
-- nobody could read.
ALTER TABLE "website_request" ADD CONSTRAINT "website_request_lifecycle_chk"
    CHECK (
        ("status" = 'NEW') = ("status_changed_at" IS NULL)
        AND ("status" = 'CLOSED') = ("closed_at" IS NOT NULL)
        AND ("linked_family_id" IS NULL) = ("linked_at" IS NULL)
        AND ("linked_family_id" IS NULL) = ("linked_by_user_id" IS NULL)
    );

-- --- linked and converted are ONE fact, in both directions ------------------
--
-- A converted request always names a family, and a request that names a family
-- is always converted. Written as a biconditional rather than as two rules,
-- because the two failures it prevents are opposite and both are quiet:
--
--   * `CONVERTED_TO_FAMILY` with no family is a status claiming a conversion
--     nobody could follow up — the request would say it had become a clinic
--     record and name none.
--   * a family link in any other status is a request that IS converted and does
--     not say so, which is worse: the retention rule keys on "never linked", and
--     a linked request sitting in `CLOSED` is precisely the row an erasure must
--     not touch and would be looking straight at.
ALTER TABLE "website_request" ADD CONSTRAINT "website_request_link_chk"
    CHECK (("status" = 'CONVERTED_TO_FAMILY') = ("linked_family_id" IS NOT NULL));

-- --- the ninety-day erasure, as a database guarantee ------------------------
--
-- THE ACCEPTED RETENTION POLICY, ENFORCED RATHER THAN REMEMBERED. Read it as
-- three sentences, each of which is a way somebody could destroy something they
-- should not have:
--
--   1. ONLY A CLOSED REQUEST IS EVER ERASED. A request still being worked on
--      keeps its content, because the colleague who is going to ring back needs
--      the number.
--   2. A LINKED REQUEST IS NEVER ERASED. It has become part of a family's
--      history, and the ninety-day promise was made about strangers the clinic
--      never heard from again — not about the families they became.
--   3. NOT BEFORE NINETY DAYS HAVE PASSED SINCE CLOSURE. Early erasure is not a
--      privacy win: it destroys a record the clinic may still need to explain
--      what it did, and it does it on a schedule nobody approved.
--
-- Together with `website_request_purge_chk` from A3 — which requires the erasure
-- to be COMPLETE — the pair says: erase all of it, only this, and only now.
ALTER TABLE "website_request" ADD CONSTRAINT "website_request_purge_eligibility_chk"
    CHECK (
        "purged_at" IS NULL
        OR (
            "status" = 'CLOSED'
            AND "linked_family_id" IS NULL
            AND "closed_at" IS NOT NULL
            AND "purged_at" >= "closed_at" + INTERVAL '90 days'
        )
    );

-- --- the legal moves, refused underneath every service that forgets ---------
--
-- The transition matrix is stated in `@clinic/contracts`
-- (`WEBSITE_REQUEST_LEGAL_TRANSITIONS`) so the screen offers exactly the moves
-- that exist and NestJS refuses the rest with a readable code. THIS is why it is
-- also stated here: a status column that a data fix, a future service or a psql
-- prompt could set to anything would make `closed_at`, and therefore the
-- retention deadline, meaningless. The application layer is the explanation; the
-- trigger is the guarantee.
--
-- It also enforces the two write-once facts the terminal states depend on:
-- `closed_at` is stamped once and never moved, and the family link is written
-- once and never re-pointed or cleared. Both follow from the statuses being
-- terminal, and both are stated separately so that a future migration relaxing
-- one has to say so out loud.
CREATE OR REPLACE FUNCTION "enforce_website_request_transition"() RETURNS trigger AS $$
BEGIN
    IF NEW."status" IS DISTINCT FROM OLD."status" THEN
        IF NOT (
            (OLD."status" = 'NEW' AND NEW."status" IN
                ('CONTACTED', 'FOLLOW_UP_NEEDED', 'CONVERTED_TO_FAMILY', 'CLOSED'))
            OR (OLD."status" = 'CONTACTED' AND NEW."status" IN
                ('FOLLOW_UP_NEEDED', 'CONVERTED_TO_FAMILY', 'CLOSED'))
            OR (OLD."status" = 'FOLLOW_UP_NEEDED' AND NEW."status" IN
                ('CONTACTED', 'CONVERTED_TO_FAMILY', 'CLOSED'))
        ) THEN
            RAISE EXCEPTION
                'website_request status may not move from % to %', OLD."status", NEW."status"
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- Write-once, because `CLOSED` is terminal and this is what the ninety-day
    -- deadline is measured from.
    IF OLD."closed_at" IS NOT NULL AND NEW."closed_at" IS DISTINCT FROM OLD."closed_at" THEN
        RAISE EXCEPTION
            'website_request.closed_at is written once and never rewritten or cleared'
            USING ERRCODE = '23001';
    END IF;

    -- Write-once, because a request is linked to at most one family EVER. A link
    -- that could be re-pointed would rewrite a claim about whose message this
    -- was; a link that could be cleared would make a converted request purgeable.
    IF OLD."linked_family_id" IS NOT NULL AND (
        NEW."linked_family_id" IS DISTINCT FROM OLD."linked_family_id"
        OR NEW."linked_at" IS DISTINCT FROM OLD."linked_at"
        OR NEW."linked_by_user_id" IS DISTINCT FROM OLD."linked_by_user_id"
    ) THEN
        RAISE EXCEPTION
            'website_request is linked to at most one family, and the link is never rewritten'
            USING ERRCODE = '23001';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "website_request_status_transition"
    BEFORE UPDATE ON "website_request"
    FOR EACH ROW EXECUTE FUNCTION "enforce_website_request_transition"();

-- --- A3's immutability rule, extended to the columns A4 adds ---------------
--
-- The A3 function permits exactly two kinds of change: CLEARING a purgeable
-- column, and STAMPING `purged_at` once. Everything it names is unchanged below
-- — the id, the arrival instant, the consent evidence and every intake column
-- are refused exactly as before, and the erasure path still works.
--
-- WHAT IS ADDED IS ONE SENTENCE: A PURGED ROW IS FINISHED. Once the content is
-- gone the lifecycle is over too, so no column of it may move again. Without
-- this, a purged request could still be transitioned or linked, and a family's
-- history could be built out of a row whose contents nobody can see any more.
--
-- The status and link rules themselves live in the separate
-- `enforce_website_request_transition` trigger above rather than here, because
-- they are a WORKFLOW policy and this function is an IMMUTABILITY rule. A future
-- checkpoint that widens the workflow edits one function; nothing about what a
-- visitor said is in reach of that edit.
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

    -- ADDED IN A4. A purged row is finished: its content is gone and its
    -- lifecycle is over, so nothing about it moves again.
    IF OLD."purged_at" IS NOT NULL AND (
        NEW."status" IS DISTINCT FROM OLD."status"
        OR NEW."status_changed_at" IS DISTINCT FROM OLD."status_changed_at"
        OR NEW."closed_at" IS DISTINCT FROM OLD."closed_at"
        OR NEW."linked_family_id" IS DISTINCT FROM OLD."linked_family_id"
        OR NEW."linked_at" IS DISTINCT FROM OLD."linked_at"
        OR NEW."linked_by_user_id" IS DISTINCT FROM OLD."linked_by_user_id"
    ) THEN
        RAISE EXCEPTION
            'website_request lifecycle is closed once its content has been erased'
            USING ERRCODE = '23001';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
