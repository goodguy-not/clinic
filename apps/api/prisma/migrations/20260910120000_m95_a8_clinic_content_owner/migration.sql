-- Milestone 9.5, checkpoint A8 — two new enum labels, and nothing else.
--
-- WHY THIS IS A MIGRATION OF ITS OWN, AND NOT THE FIRST LINES OF THE NEXT ONE.
-- PostgreSQL permits `ALTER TYPE ... ADD VALUE` inside a transaction block but
-- REFUSES to let the same transaction USE the label it just added. The next
-- migration redefines `media_attachment_owner_chk` with both labels in it,
-- which is exactly that forbidden use, and Prisma runs each migration file in
-- its own transaction. Two files is what the database demands, not a filing
-- preference — the same split checkpoint A7 had to make for `PUBLIC_SPACE`.
--
-- WHAT THE LABELS MEAN is stated where the columns that use them are defined.
-- In one line each:
--
--   `CLINIC_CONTENT_ENTRY` names a `clinic_content_entry` row — one editorial
--   block of the public home or about page — so an owner id is REQUIRED, and
--   the photograph is reachable only while that block has been written.
--
--   `CLINIC_OPEN_GRAPH` names NOTHING, like `CLINIC_SPACE`. It is the site's
--   own social-preview photograph, it hangs off the always-live clinic profile,
--   and manager publication of the attachment is the whole of the control.
--
-- `CLINIC_SPACE` IS UNTOUCHED and goes on meaning what checkpoint A5 froze: an
-- ownerless slot that no public projection in this product reads.
--
-- NOTHING IS VISIBLE TO ANYBODY AFTER THIS FILE. Adding a label to an enum
-- publishes nothing, changes no row and grants no authority.

-- AlterEnum
ALTER TYPE "media_attachment_owner" ADD VALUE 'CLINIC_CONTENT_ENTRY';
ALTER TYPE "media_attachment_owner" ADD VALUE 'CLINIC_OPEN_GRAPH';
