-- Milestone 8, checkpoint C4 — the therapist/clinic allocation of a concession.
--
-- WHAT THIS CHECKPOINT CHANGES, IN ONE SENTENCE: a family concession stops being
-- necessarily clinic-borne, and becomes an explicit allocation between the
-- therapist and the clinic that the database itself keeps coherent with the
-- applied share snapshot C3 froze onto the session.
--
-- THIS MIGRATION ADDS NO COLUMN AND NO TABLE, and that is a decision rather than
-- an economy. `charge_adjustment` already carries `therapist_discount_toman` and
-- `clinic_discount_toman` — Milestone 5 wrote both, pinned the first to zero and
-- said in that migration that the pinning was the POLICY of that milestone and
-- not the shape of the table. So the shape is right and only the policy is
-- wrong, and what changes here is the policy: one CHECK is dropped and the rules
-- that replace it are stated where they can actually be stated.
--
-- THE LEDGER STILL CARRIES NO SETTLEMENT COLUMN. There is deliberately no
-- `session_settlement_id` on `charge_adjustment`. A concession belongs to a
-- CHARGE, a rating belongs to the SAME charge, and at most one rating of a
-- charge ever stands (`session_settlement_one_valid_per_charge_uq`) — so "which
-- share does this portion bear against" already has exactly one answer, derived
-- by the join, and a stored copy of it would be a second answer that can
-- disagree with the first. It would also point at a row that a correction
-- withdraws, and `enforce_charge_adjustment_immutability` forbids re-pointing
-- it, so the copy would rot by design. `ledger-schema.int-spec.ts` asserts the
-- absence of such a column and continues to pass unchanged.
--
-- WHAT IS DELIBERATELY NOT HERE: no net column, no earned/unsettled aggregate,
-- no `settlement_period`, no `settlement_line`, no payout and no export. A net
-- figure is `therapist_gross_toman` minus the active therapist portions and is
-- DERIVED BY READING, exactly as `effectiveAmountToman` is derived from the
-- charge and its active adjustments; storing it would create a total that can
-- disagree with the rows beneath it, which is the mistake the ledger already
-- refuses to make. Closed-period semantics remain checkpoint C6.
--
-- NOTHING IS BACK-FILLED AND NOTHING IS REWRITTEN. Every `charge_adjustment` row
-- written before this migration has `therapist_discount_toman = 0` — the dropped
-- CHECK guaranteed it — and every such row satisfies the constraints below
-- unchanged. No UPDATE is issued against any historical financial row here.

-- ===========================================================================
-- 1. The Milestone 5 policy CHECK is dropped, and only that one.
--
-- `charge_adjustment_clinic_borne_chk` (`therapist_discount_toman = 0`) was
-- written with its own reason for existing and with its own expiry: "Therapist
-- settlement ... is Milestone 8 and is not approved here. Without it there is no
-- basis on which a therapist could be said to have agreed to bear part of a
-- discount, and a row claiming they had would be an unfunded liability recorded
-- as a fact" (`20260814090000_m5_ledger_schema`).
--
-- That basis now exists and is authoritative: C2 records the effective-dated
-- agreement, and C3 snapshots the applied percentage and the therapist's gross
-- share onto the session at the moment it is rated. A therapist-borne portion is
-- therefore no longer unfunded — it is bounded, below, by a share that was
-- actually applied to that session and is frozen against every later change to
-- the agreement.
--
-- `charge_adjustment_split_identity_chk` IS UNTOUCHED and is what makes the
-- allocation coherent: therapist + clinic = the total family concession
-- (CLAUDE.md). It was written "in its general form so the stored allocation is
-- internally coherent whatever the two parts later become", and this is what
-- they became. `charge_adjustment_amount_bounds_chk` is untouched too, and it is
-- what keeps both portions at or above zero.
-- ===========================================================================

ALTER TABLE "charge_adjustment" DROP CONSTRAINT "charge_adjustment_clinic_borne_chk";

-- ===========================================================================
-- 2. The therapist-net floor, in the trigger that already holds the right lock.
--
-- "Therapist net share must never be negative" (CLAUDE.md) is a statement about
-- a SUM — the applied gross share of the session, less every therapist-borne
-- portion still active against it — so no CHECK can express it, for exactly the
-- reason the family's effective-charge floor could not be a CHECK either.
--
-- IT IS THE SAME QUESTION, ASKED OF THE OTHER SIDE OF THE MONEY, UNDER THE SAME
-- LOCK, IN THE SAME TRIGGER. `enforce_charge_adjustment_bounds` already takes
-- `session_charge` `FOR UPDATE` before deciding anything, and every write that
-- can move either side of this inequality serialises on that one row:
--
--   * every concession against the charge is an INSERT here, and waits;
--   * every rating write takes the charge lock first, in this project's single
--     lock order — `SessionRatingService.lockRatableCharge` and
--     `lockRatingUnderItsCharge` both do it before touching `session_settlement`.
--
-- So the gross read below and the sum read below cannot move under this
-- statement's feet, and two concurrent allocations cannot both pass on a stale
-- allowance. A SECOND trigger with a second lock would have been a second lock
-- order and therefore a deadlock.
--
-- A ZERO PORTION READS NOTHING AND CHANGES NOTHING. The whole block is skipped
-- when `therapist_discount_toman = 0`, so an ordinary clinic-borne concession —
-- the overwhelming majority, and every row written before this migration —
-- executes precisely the statements it executed yesterday, against an unrated
-- session as happily as against a rated one.
--
-- THE TWO NEW REFUSALS CARRY NAMES AND THE OLD ONE IS LEFT EXACTLY AS IT WAS.
-- All three are `check_violation`, so the SQLSTATE alone cannot tell
-- `ADJUSTMENT_SPLIT_INVALID` from `ADJUSTMENT_EXCEEDS_CHARGE` and the service
-- matches on a name as well. The name is stated TWICE on each new raise — as
-- `USING CONSTRAINT`, which is what a psql session and any future driver read,
-- and as a prefix of the message text, because Prisma surfaces the message of a
-- raw-SQL error and does not reliably surface the constraint field of a
-- hand-raised one. `violatesConstraint` checks both, so neither is redundant.
-- The pre-existing ceiling raise is untouched, byte for byte, and stays
-- identified by exclusion exactly as it already was.
--
-- WHY A NON-AUTHORITATIVE RATING IS REFUSED RATHER THAN IGNORED. A portion borne
-- against a session with no standing rating is a liability apportioned to a
-- share nobody ever applied; writing it and sorting it out at settlement is how
-- a therapist discovers a deduction they cannot trace. `voided_at IS NULL` is
-- the whole of "authoritative" here, and it is the same predicate the unique
-- index is partial on.
-- ===========================================================================

CREATE OR REPLACE FUNCTION "enforce_charge_adjustment_bounds"() RETURNS trigger
    LANGUAGE plpgsql AS $fn$
DECLARE
    charge_amount    bigint;
    charge_voided    timestamptz;
    active_total     bigint;
    therapist_gross  bigint;
    therapist_active bigint;
BEGIN
    -- The parent, locked before anything is decided. Taken here in a BEFORE
    -- trigger, which runs ahead of the foreign key's own check on the same row,
    -- so the stronger lock is always the first one acquired.
    SELECT "amount_toman", "voided_at"
      INTO charge_amount, charge_voided
      FROM "session_charge"
     WHERE "id" = NEW."session_charge_id"
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'session charge % does not exist', NEW."session_charge_id"
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    -- A voided charge is history. Adding a concession to it would change what a
    -- withdrawn record says, and the replacement charge — not this one — is what
    -- a live adjustment belongs to.
    IF charge_voided IS NOT NULL THEN
        RAISE EXCEPTION
            'session charge % is voided and cannot be adjusted', NEW."session_charge_id"
            USING ERRCODE = 'restrict_violation';
    END IF;

    SELECT coalesce(sum("amount_toman"), 0)
      INTO active_total
      FROM "charge_adjustment"
     WHERE "session_charge_id" = NEW."session_charge_id"
       AND "voided_at" IS NULL;

    IF active_total + NEW."amount_toman" > charge_amount THEN
        RAISE EXCEPTION
            'adjustments against session charge % would total %, exceeding the charge of %',
            NEW."session_charge_id", active_total + NEW."amount_toman", charge_amount
            USING ERRCODE = 'check_violation';
    END IF;

    -- Everything below concerns a THERAPIST-BORNE portion only. A clinic-borne
    -- concession is not a settlement fact and asks the settlement table nothing.
    IF NEW."therapist_discount_toman" = 0 THEN
        RETURN NEW;
    END IF;

    -- The applied snapshot, and only a STANDING one. Read under the charge lock
    -- taken above, which is what makes it stable for the rest of this statement;
    -- no second lock is taken, because taking one here would invert this
    -- project's charge-then-rating order.
    SELECT "therapist_gross_toman"
      INTO therapist_gross
      FROM "session_settlement"
     WHERE "session_charge_id" = NEW."session_charge_id"
       AND "voided_at" IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'charge_adjustment_therapist_share_required: session charge % carries no valid rating to bear a therapist portion against',
            NEW."session_charge_id"
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'charge_adjustment_therapist_share_required';
    END IF;

    SELECT coalesce(sum("therapist_discount_toman"), 0)
      INTO therapist_active
      FROM "charge_adjustment"
     WHERE "session_charge_id" = NEW."session_charge_id"
       AND "voided_at" IS NULL;

    -- A FREE session needs no rule of its own: its base is zero, so its applied
    -- gross is zero, so any positive portion exceeds it and is refused here.
    IF therapist_active + NEW."therapist_discount_toman" > therapist_gross THEN
        RAISE EXCEPTION
            'charge_adjustment_therapist_net_floor: therapist-borne concessions against session charge % would total %, exceeding the applied therapist share of %',
            NEW."session_charge_id",
            therapist_active + NEW."therapist_discount_toman",
            therapist_gross
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'charge_adjustment_therapist_net_floor';
    END IF;

    RETURN NEW;
END;
$fn$;

-- ===========================================================================
-- 3. A rating cannot be withdrawn out from under a standing allocation.
--
-- C3 recorded the code `RATING_HAS_THERAPIST_ALLOCATIONS` and left it
-- unreachable, because therapist-borne allocation was impossible. Section 2
-- makes it possible, so this makes the refusal real.
--
-- WHAT IT PROTECTS. Withdrawing a rating removes the applied gross share that a
-- therapist-borne portion was measured against and bounded by. The portion would
-- survive as an active row apportioned to a share that no longer stands, and the
-- floor in section 2 — which reads only STANDING ratings — would no longer be
-- checking anything at all. That is a deduction from somebody's earnings with
-- nothing behind it.
--
-- A CORRECTION IS REFUSED TOO, AND FOR THE SAME REASON RATHER THAN A WEAKER ONE.
-- `SessionRatingService.correct` withdraws and replaces in one transaction, so
-- this trigger fires on the withdrawal half and refuses it. The alternative —
-- letting a correction through when the replacement's gross happens to be large
-- enough — would silently re-anchor an allocation a manager reasoned about
-- against one applied percentage onto a different one they never saw. The
-- allocation is withdrawn first, deliberately, with its own actor and reason;
-- then the rating is corrected; then the allocation is re-granted against the
-- share that now applies. Three explicit acts, three audit rows, and no figure
-- that changed because of something done to a different record.
--
-- IT IS NOT A CLOSED-PERIOD RULE. Nothing here consults a settlement period,
-- because none exists; `RATING_REPLACEMENT_REQUIRED` and everything around it
-- remains C6.
--
-- ONLY THE VOID TRANSITION IS GUARDED. `session_settlement` permits no other
-- UPDATE at all (`enforce_session_settlement_immutability`), so this fires on
-- the one statement that can invalidate an allocation, and an already-withdrawn
-- row cannot reach it twice.
--
-- A SEPARATE TRIGGER FROM THE IMMUTABILITY ONE, because it is a different rule:
-- immutability is about what a statement may CHANGE, and this is about what a
-- permitted change would leave BEHIND. Both are `BEFORE UPDATE`; either refusing
-- aborts the statement, so their relative order carries no meaning.
-- ===========================================================================

CREATE OR REPLACE FUNCTION "enforce_session_settlement_allocation_guard"() RETURNS trigger
    LANGUAGE plpgsql AS $fn$
DECLARE
    allocated bigint;
BEGIN
    IF OLD."voided_at" IS NOT NULL OR NEW."voided_at" IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT coalesce(sum("therapist_discount_toman"), 0)
      INTO allocated
      FROM "charge_adjustment"
     WHERE "session_charge_id" = OLD."session_charge_id"
       AND "voided_at" IS NULL;

    IF allocated > 0 THEN
        RAISE EXCEPTION
            'session_settlement_has_therapist_allocations: session settlement % bears % toman of therapist-borne concession and cannot be withdrawn',
            OLD."id", allocated
            USING ERRCODE = 'restrict_violation',
                  CONSTRAINT = 'session_settlement_has_therapist_allocations';
    END IF;

    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "session_settlement_enforce_allocation_guard"
    BEFORE UPDATE ON "session_settlement"
    FOR EACH ROW EXECUTE FUNCTION "enforce_session_settlement_allocation_guard"();

-- NOTE ON COMPLETENESS: as in every earlier milestone, a table owner can still
-- run `ALTER TABLE ... DISABLE TRIGGER`. Closing that gap needs a runtime
-- database role that does not own these tables. That remains a production
-- hardening item, unchanged by this checkpoint.
