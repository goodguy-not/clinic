-- Milestone 7, checkpoint C1: the indexes clinic-wide, date-keyed reporting
-- needs, and nothing else.
--
-- NO TABLE, NO COLUMN, NO CONSTRAINT AND NO TRIGGER. Milestone 7 reads facts
-- Milestones 4, 5 and 6 already own. It stores no balance, no credit, no
-- reporting aggregate and no materialised view; there is no second source of
-- financial truth to create here, and creating one is the thing this milestone
-- must not do. Every figure a report states is derived on the request that asks
-- for it.
--
-- WHY THESE THREE. Every existing index on the financial tables is keyed on a
-- FAMILY, a child or a seat, because until now every financial read started from
-- one family. The new access pattern starts from a DATE and spans the whole
-- clinic, and under that predicate `payment_family_id_received_on_idx` and
-- `session_charge_family_id_service_date_idx` cannot be used at all: the leading
-- column is not in the query. Without these three, the first dashboard read of a
-- clinic with three years of history is a sequential scan of every charge and
-- every payment ever recorded.
--
-- WHAT IS DELIBERATELY NOT ADDED:
--
--   * nothing on `payment_promise`. `payment_promise_status_due_on_idx` already
--     leads with the status and then the due date, which is exactly the promise
--     report's predicate — the overdue and due-soon reads the dashboard and the
--     report both perform. A bare `due_on` index would duplicate its second
--     column to serve a status-less query nobody has asked for.
--   * nothing on `appointment`. `appointment_starts_at_idx` already serves the
--     clinic-wide day and range reads, through the same half-open instant range
--     the day view uses (`clinic_day_start`, Milestone 4 checkpoint A4);
--     `appointment_therapist_id_starts_at_idx` serves the therapist activity
--     report's narrowed form.
--   * no covering index, no partial index and no expression index. A partial
--     index on the non-voided rows would be tempting and wrong: reports show
--     voided rows by default, because financial history is visible unless
--     somebody asks to hide it.
--   * no `clinic_date(...)` expression index anywhere. `clinic_date` is STABLE
--     and not IMMUTABLE — timezone definitions can change — so it may not appear
--     in an index at all. Reports ask the question from the other side, as a
--     range over the plain column, which is the pattern Milestone 4 established.
--
-- These are ordinary B-tree indexes over columns that already exist. They change
-- no row, hold no rule, and can be dropped and recreated without touching data.

-- What the whole clinic charged for the sessions of a day or a period. The
-- charge's own clinic calendar day, never the day it was entered: a charge
-- posted late belongs to the session it prices.
CREATE INDEX "session_charge_service_date_idx" ON "session_charge"("service_date");

-- What the clinic took in over a period, on the business day the money arrived.
-- The payments report's basis.
CREATE INDEX "payment_received_on_idx" ON "payment"("received_on");

-- What was ENTERED on a clinic day: the daily reconciliation's basis, and a
-- different question from the one above about the very same rows. A payment
-- received on Thursday and entered on Saturday is in Saturday's drawer and in
-- Thursday's takings, so the two reads need the two indexes.
CREATE INDEX "payment_created_at_idx" ON "payment"("created_at");
