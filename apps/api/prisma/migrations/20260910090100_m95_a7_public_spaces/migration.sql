-- Milestone 9.5, checkpoint A7 — public spaces, and the one rule that stops a
-- handwritten testimonial being published from pixels.
--
-- WHAT THIS MIGRATION MAKES POSSIBLE, IN ONE SENTENCE: the clinic can describe
-- parts of its own building to a visitor — words a receptionist drafts,
-- photographs the A5 system already holds, and a publication only a manager can
-- perform — WITHOUT that description being coupled to the rooms the diary books.
--
-- ONE TABLE, TWO COLUMNS, ONE REDEFINED CHECK AND ONE NEW ONE. That is the
-- whole schema footprint. There is no room-to-space link table, no gallery
-- table, no caption table, no OCR column, no transcription-confidence column
-- and no second copy of anything.
--
-- =====================================================================
-- 1. A PUBLIC SPACE IS NOT AN OPERATIONAL ROOM, AND THE PROOF IS AN ABSENCE
-- =====================================================================
--
-- `public_space` HOLDS NO REFERENCE TO `room`, AND `room` HOLDS NONE TO IT.
-- The two tables share no foreign key and cannot be joined. Everything the
-- checkpoint requires follows from that single absence, as a property of the
-- SCHEMA rather than as a discipline a projection has to keep:
--
--   * Creating, renaming, restricting or DEACTIVATING a room cannot create,
--     alter, publish or unpublish a space. There is no path from one row to the
--     other, so there is no statement that could.
--   * No room id, room status, service restriction, availability window,
--     scheduling meaning or other operational metadata can reach a visitor
--     through a space. No such column exists here, and no join can produce one.
--     A leak would need a new column and a reviewed migration.
--   * The clinic may publish a corridor, a garden, or one description covering
--     three rooms — and may run six rooms while publishing nothing at all.
--
-- A NULLABLE MANAGER-SET LINK WAS CONSIDERED AND REJECTED. Nothing in the
-- accepted product asks a space which room it is; a column that answers an
-- unasked question is the first half of the coupling this checkpoint exists to
-- prevent, and "it is nullable and nothing publishes from it" is a promise
-- about code rather than a guarantee about data. REVISIT IF a decision arrives
-- that genuinely needs the join — a room-level public page, or an operational
-- report about published spaces — at which point it is one nullable column, one
-- migration, and an explicit statement then that it publishes nothing.
--
-- =====================================================================
-- 2. THE COPY IS HELD TWICE, AND THAT IS THE PUBLICATION AUTHORITY
-- =====================================================================
--
-- The A2 shape, reused unchanged: `name`, `description` and `display_order` are
-- the receptionist's working draft; `published_name`, `published_description`
-- and `published_display_order` are what the website reads, and only the
-- manager-only publication act writes them. With one set of columns the product
-- would have to choose between two broken rules — a receptionist's unreviewed
-- sentence on the live page the instant they save it, or a published space
-- nobody can correct without a manager doing the typing. The accepted rule is
-- neither (DECISION_LOG, 2026-09-08 — Editorial authority and operational
-- authority are split).
--
-- `display_order` IS SPLIT TOO. Reordering a published gallery is a change a
-- visitor sees, so it waits for the same manager act the words wait for.
-- Publishing copies all three at once, which keeps "publish" one decision.
--
-- `public_space_published_copy_chk` REFUSES `is_public` ON A ROW WHOSE PUBLISHED
-- COPY NOBODY HAS WRITTEN, so the flag alone can never put a draft on the
-- website — the `public_article_published_copy_chk` rule, applied here.
--
-- NO SLUG AND NO URL. A space is an entry in a gallery, not a page, so it needs
-- no stability trigger and appears in no sitemap. It gets the publication STAMP
-- instead, from the shared `stamp_first_publication()`, so the gallery has a
-- stable tie-break.
--
-- =====================================================================
-- 3. THE PHOTOGRAPHS ARE THE A5 SYSTEM, USED RATHER THAN REDESIGNED
-- =====================================================================
--
-- `media_attachment.space_id` IS THE FOURTH REAL FOREIGN KEY under the existing
-- discriminator, and it makes `PUBLIC_SPACE` behave like the three owner types
-- that already have rows: a photograph of the waiting area is anonymously
-- reachable only while the attachment is published by a manager AND the space
-- it describes is itself published. Every A5 invariant is untouched — the
-- master is still not servable, EXIF is still stripped, attaching is still
-- drafting, unpublishing still revokes at the origin immediately, and the
-- five-minute window is still the only cache promise.
--
-- `CLINIC_SPACE` IS DELIBERATELY UNCHANGED AND IS NOT MIGRATED INTO THE NEW
-- TYPE. It stays ownerless, no public projection reads it, and no row moves.
-- Redefining it would have silently turned the web tier's "uploaded and framed
-- but not yet placed" parking slot into a live public-gallery target — which is
-- precisely the accident this checkpoint exists to prevent — and would have
-- rewritten an accepted A5 contract that Agent B builds against today.
--
-- =====================================================================
-- 4. A HANDWRITTEN TESTIMONIAL MAY NOT BE PUBLISHED FROM PIXELS ALONE
-- =====================================================================
--
-- `public_testimonial.kind` records how the words arrived and NOTHING ELSE. It
-- is not identifying and it is not clinical: no family, no child, no age, no
-- diagnosis, no service, no therapist and no date of treatment is added here,
-- and the A2 privacy-by-absence model is exactly as it was.
--
-- `public_testimonial_handwritten_body_chk` STATES THE RULE IN THE DATABASE:
-- a `HANDWRITTEN` row must carry a non-empty transcription. `body` is NOT NULL
-- and already trimmed and non-empty for every kind, so this constraint can
-- never change a result today — which is exactly why it is written out. The
-- cost of the application and the schema disagreeing here is a photograph of a
-- family's handwriting published as a testimonial whose meaning nobody read,
-- and a reader should be able to see that rule in a constraint rather than have
-- to trust a service method.
--
-- NO COLUMN IN THIS SCHEMA HOLDS MACHINE-READ TEXT. There is no OCR in this
-- product, no field for its output, and no flag recording that software was
-- consulted. A transcription is what a human read, corrected and saved through
-- the ordinary draft route; if the web tier ever offers transcription as a
-- drafting aid, what reaches this column is indistinguishable from typing.
--
-- THE CONSENT POLICY IS NOT ENCODED HERE, IN ANY FORM. Manager approval remains
-- the privacy gate this product enforces. How consent to publish a family's
-- words is obtained, recorded, versioned or withdrawn is an owner and legal
-- decision (PROJECT_SPEC.md 17), and no column, constraint or default below
-- guesses at it.
--
-- The section above the "HAND-WRITTEN" banner is generated by Prisma.
-- Everything below it is reviewed by a human. Each hand-written object is
-- named, and `public-space-schema.int-spec.ts` asserts every name exists in the
-- PostgreSQL catalogue, so a future edit cannot quietly drop one.

-- CreateEnum
-- A BRAND-NEW type, so it may be created and used in one transaction. Only
-- ADDING a label to an EXISTING enum is what the previous migration had to be
-- split out for.
CREATE TYPE "testimonial_kind" AS ENUM ('TYPED', 'HANDWRITTEN');

-- AlterTable
ALTER TABLE "media_attachment" ADD COLUMN     "space_id" UUID;

-- AlterTable
ALTER TABLE "public_testimonial" ADD COLUMN     "kind" "testimonial_kind" NOT NULL DEFAULT 'TYPED';

-- CreateTable
CREATE TABLE "public_space" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "display_order" SMALLINT NOT NULL DEFAULT 0,
    "published_name" TEXT,
    "published_description" TEXT,
    "published_display_order" SMALLINT,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "public_first_published_at" TIMESTAMPTZ,
    "public_revised_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID NOT NULL,

    CONSTRAINT "public_space_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "public_space_is_public_published_display_order_idx" ON "public_space"("is_public", "published_display_order");

-- CreateIndex
CREATE INDEX "media_attachment_space_id_position_idx" ON "media_attachment"("space_id", "position");

-- AddForeignKey
ALTER TABLE "public_space" ADD CONSTRAINT "public_space_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_attachment" ADD CONSTRAINT "media_attachment_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "public_space"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================ HAND-WRITTEN ==================================

-- --- the space's own copy ---------------------------------------------------
--
-- Each column carries the same trimmed, bounded, markup-free rule the A2
-- content columns carry, and each PUBLISHED column carries exactly the rule of
-- the column it is copied from — not a stricter one, because a publication must
-- never be refused by a rule the draft was not held to.
--
-- `position('<' IN ...) = 0` IS THE NO-MARKUP RULE, and it is why the web tier
-- needs no sanitiser for this table: markup cannot be stored, so no `<script>`
-- can reach a renderer.

ALTER TABLE "public_space" ADD CONSTRAINT "public_space_name_chk"
    CHECK (
        "name" = btrim("name")
        AND btrim("name") <> ''
        AND length("name") <= 200
        AND position('<' IN "name") = 0
    );

ALTER TABLE "public_space" ADD CONSTRAINT "public_space_description_chk"
    CHECK (
        "description" IS NULL
        OR (
            "description" = btrim("description")
            AND btrim("description") <> ''
            AND length("description") <= 20000
            AND position('<' IN "description") = 0
        )
    );

ALTER TABLE "public_space" ADD CONSTRAINT "public_space_published_name_chk"
    CHECK (
        "published_name" IS NULL
        OR (
            "published_name" = btrim("published_name")
            AND btrim("published_name") <> ''
            AND length("published_name") <= 200
            AND position('<' IN "published_name") = 0
        )
    );

ALTER TABLE "public_space" ADD CONSTRAINT "public_space_published_description_chk"
    CHECK (
        "published_description" IS NULL
        OR (
            "published_description" = btrim("published_description")
            AND btrim("published_description") <> ''
            AND length("published_description") <= 20000
            AND position('<' IN "published_description") = 0
        )
    );

-- A gallery position is a hint about order, not an index into anything, and a
-- clinic publishes a handful of spaces. Bounded on both sides so a negative or
-- absurd value cannot be stored and then have to be reasoned about downstream.
ALTER TABLE "public_space" ADD CONSTRAINT "public_space_display_order_chk"
    CHECK (
        "display_order" BETWEEN 0 AND 1000
        AND ("published_display_order" IS NULL OR "published_display_order" BETWEEN 0 AND 1000)
    );

-- THE FLAG ALONE CANNOT PUBLISH A DRAFT.
--
-- A public space must have published copy for the website to read. The name and
-- the ordering are required because the gallery cannot render an entry without
-- them; the description is not, because a space may legitimately be a
-- photograph and a heading.
ALTER TABLE "public_space" ADD CONSTRAINT "public_space_published_copy_chk"
    CHECK (
        "is_public" IS FALSE
        OR ("published_name" IS NOT NULL AND "published_display_order" IS NOT NULL)
    );

ALTER TABLE "public_space" ADD CONSTRAINT "public_space_public_revised_chk"
    CHECK ("public_revised_at" IS NULL OR "public_first_published_at" IS NOT NULL);

-- The shared stamp, written the first time the row is public and never
-- rewritten afterwards. A space has no slug, so it needs no stability trigger.
CREATE TRIGGER "public_space_first_publication"
    BEFORE INSERT OR UPDATE ON "public_space"
    FOR EACH ROW EXECUTE FUNCTION "stamp_first_publication"();

-- --- no deletion (reuses the Milestone 1 shared function) -------------------
--
-- Published content is WITHDRAWN, never erased. A deleted space is a paragraph
-- and a set of photographs vanishing with no record that the clinic ever
-- published them; `is_public` is how a space comes off the site, and it is
-- immediate.

CREATE TRIGGER "public_space_no_delete"
    BEFORE DELETE ON "public_space"
    FOR EACH ROW EXECUTE FUNCTION "raise_append_only_violation"();

CREATE TRIGGER "public_space_no_truncate"
    BEFORE TRUNCATE ON "public_space"
    FOR EACH STATEMENT EXECUTE FUNCTION "raise_append_only_violation"();

-- --- the attachment owner rule, restated over five branches -----------------
--
-- REDEFINED RATHER THAN ADDED TO, because a polymorphic reference is only as
-- good as the constraint that pins it: every branch has to name every column,
-- or a `PUBLIC_ARTICLE` attachment could quietly also carry a `space_id` and
-- two different reads would disagree about what it is attached to.
--
-- `CLINIC_SPACE` STILL NAMES NOTHING, and `PUBLIC_SPACE` NAMES EXACTLY ONE
-- SPACE. That is the whole difference between A5's ownerless slot and A7's
-- editorial owner, stated where the database can enforce it.
ALTER TABLE "media_attachment" DROP CONSTRAINT "media_attachment_owner_chk";

ALTER TABLE "media_attachment" ADD CONSTRAINT "media_attachment_owner_chk"
    CHECK (
        CASE "owner_type"
            WHEN 'THERAPIST_PROFILE' THEN
                "therapist_id" IS NOT NULL AND "article_id" IS NULL
                AND "testimonial_id" IS NULL AND "space_id" IS NULL
            WHEN 'PUBLIC_ARTICLE' THEN
                "article_id" IS NOT NULL AND "therapist_id" IS NULL
                AND "testimonial_id" IS NULL AND "space_id" IS NULL
            WHEN 'PUBLIC_TESTIMONIAL' THEN
                "testimonial_id" IS NOT NULL AND "therapist_id" IS NULL
                AND "article_id" IS NULL AND "space_id" IS NULL
            WHEN 'PUBLIC_SPACE' THEN
                "space_id" IS NOT NULL AND "therapist_id" IS NULL
                AND "article_id" IS NULL AND "testimonial_id" IS NULL
            WHEN 'CLINIC_SPACE' THEN
                "therapist_id" IS NULL AND "article_id" IS NULL
                AND "testimonial_id" IS NULL AND "space_id" IS NULL
        END
    );

-- --- the handwritten transcription rule -------------------------------------
--
-- A HANDWRITTEN TESTIMONIAL MUST CARRY THE WORDS. The photograph may accompany
-- it; it may never stand in for it. `public_testimonial_body_chk` already
-- demands a trimmed, non-empty `body` of every row, so this can never change a
-- result — and that is the point: the rule a reader has to be able to find is
-- "a handwritten note is not publishable from pixels", and it belongs in a
-- constraint carrying its own name rather than inside a service method.
ALTER TABLE "public_testimonial" ADD CONSTRAINT "public_testimonial_handwritten_body_chk"
    CHECK (
        "kind" <> 'HANDWRITTEN'
        OR ("body" IS NOT NULL AND btrim("body") <> '')
    );
