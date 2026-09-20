-- Milestone 9.5, checkpoint A9 — one new enum label, and nothing else.
--
-- WHY THIS IS A MIGRATION OF ITS OWN, AND NOT THE FIRST LINE OF THE NEXT ONE.
-- PostgreSQL permits `ALTER TYPE ... ADD VALUE` inside a transaction block but
-- REFUSES to let the same transaction USE the label it just added. The next
-- migration redefines `media_attachment_owner_chk` with the label in it, which
-- is exactly that forbidden use, and Prisma runs each migration file in its own
-- transaction. Two files is what the database demands, not a filing preference
-- — the same split checkpoints A7 and A8 had to make.
--
-- WHAT THE LABEL MEANS is stated where the column that uses it is defined. In
-- one line: `PUBLIC_SERVICE` names a `service` row, so an owner id is REQUIRED,
-- and the photograph is reachable only while that service is itself publicly
-- reachable.
--
-- NOTHING IS VISIBLE TO ANYBODY AFTER THIS FILE. Adding a label to an enum
-- publishes nothing, changes no row and grants no authority.

-- AlterEnum
ALTER TYPE "media_attachment_owner" ADD VALUE 'PUBLIC_SERVICE';
