-- Milestone 9.5, checkpoint A8 — the clinic's routine public copy becomes data.
--
-- WHAT THIS MIGRATION MAKES POSSIBLE, IN ONE SENTENCE: the words on the home
-- and about pages, and the photograph a link to this site unfurls into, can be
-- changed by the manager who owns them WITHOUT a code edit, a seed or a
-- deployment — which is the last thing about this website that still needed
-- one.
--
-- ONE TABLE, ONE ENUM, ONE ATTACHMENT COLUMN AND ONE REDEFINED CHECK. That is
-- the whole schema footprint. There is no page table, no section table, no
-- block tree, no template, no revision table, no translation table and no
-- second copy of anything.
--
-- =====================================================================
-- 1. A1 SAID COPY BLOCKS WERE NOT COLUMNS ON THE PROFILE. THIS AGREES.
-- =====================================================================
--
-- Checkpoint A1 created `clinic_public_profile` and wrote, of copy blocks and
-- page structure: "inventing a column for each would freeze a page layout in
-- the database". Nothing below adds a column to that table. The profile goes on
-- holding the clinic's FACTS — the name, the address, the telephone number, the
-- hours line, the links — and this table holds what the clinic SAYS.
--
-- THE ROWS ARE STRUCTURE, NOT CONTENT SOMEBODY WROTE. Twenty-one rows are
-- inserted at the bottom of this file with every copy column NULL, exactly as
-- A1 inserted the profile row empty. They are the blocks the accepted public
-- design renders, and their COUNTS are the design's own: five concern prompts,
-- three first-session moments, three about highlights, three about points,
-- three journey steps, and one row each for the four single blocks around them.
--
-- NOT ONE WORD OF CLINIC COPY APPEARS IN THIS FILE. No name, no address, no
-- heading, no claim, no qualification, no testimonial and no legal or consent
-- wording. All of it is owner-supplied (PROJECT_SPEC.md 17) and every fixture
-- that fills a slot in this repository is obviously synthetic.
--
-- =====================================================================
-- 2. EDITING IS PUBLISHING, AND THAT IS WHY THE COPY IS HELD ONCE
-- =====================================================================
--
-- `public_article` and `public_space` hold their copy TWICE because a
-- receptionist may prepare it and only a manager may move the page. This table
-- holds it ONCE, and the difference is a product rule rather than an
-- inconsistency: the clinic profile surface is manager-only from
-- `clinic_profile.update` down, there is no lower authority to protect the page
-- from, and A2 already froze the same answer for the profile row itself —
-- "there is one profile, it is always live, and editing it IS publishing".
--
-- A draft column pair here would therefore be two columns nobody could ever
-- write differently, plus a publication act with one possible actor.
--
-- `is_public` IS ABSENT FOR THE SAME REASON, and `heading` does its work.
--
-- =====================================================================
-- 3. AN UNWRITTEN BLOCK SAYS NOTHING — ONE RULE, TWO READERS
-- =====================================================================
--
-- `heading IS NULL` MEANS THE BLOCK IS NOT ON THE SITE. The public projection
-- omits the row, and `LIVE_ATTACHMENT_PREDICATE` refuses any photograph
-- attached to it. Both readers consult the same column, so a clinic that has
-- supplied no copy yet publishes neither a half-built section nor a picture
-- with nothing around it — and a manager clearing a heading takes the block and
-- its photograph off the site in one act, immediately.
--
-- THE OTHER THREE TEXT COLUMNS ARE NOT PART OF THAT RULE. A block may be a
-- heading and a picture, or a heading and a paragraph; which fields a given
-- slot uses is the accepted design's business and is stated in
-- `@clinic/contracts`, not enforced here. A CHECK per slot would freeze the
-- layout in the database, which is the thing A1 warned against.
--
-- =====================================================================
-- 4. THE SLOTS ARE FIXED, AND THE DATABASE IS WHAT FIXES THEM
-- =====================================================================
--
-- `clinic_content_entry_slot_size_chk` CAPS EACH SLOT AT THE ACCEPTED DESIGN'S
-- COUNT, and the UNIQUE index on (slot, position) stops two rows sharing a
-- place. Together they mean no statement in this application — and no manager
-- with a form — can produce a sixth concern prompt or a fourth about highlight.
-- The delete and truncate triggers mean none can remove the fifth.
--
-- SO THE ONLY WAY THE SHAPE OF THESE PAGES CHANGES IS A REVIEWED MIGRATION.
-- That is the intent: filling a block in is routine content maintenance and
-- belongs to the manager; adding a block is a design decision and belongs to
-- somebody who has taken it.
--
-- THERE IS NO INSERT TRIGGER, DELIBERATELY. A future checkpoint that adds a
-- slot has to INSERT its rows, and a trigger it would have to disable first is
-- a guard that teaches people to disable guards. What stops the application
-- inserting one is that no statement in it does; what stops a wrong row
-- existing is the CHECK and the UNIQUE index above.
--
-- =====================================================================
-- 5. THE PHOTOGRAPHS ARE THE A5 SYSTEM, USED RATHER THAN REDESIGNED
-- =====================================================================
--
-- `media_attachment.content_entry_id` IS THE FIFTH REAL FOREIGN KEY under the
-- existing discriminator. `CLINIC_CONTENT_ENTRY` therefore behaves like the
-- four owner types that already have rows, and `CLINIC_OPEN_GRAPH` behaves like
-- `CLINIC_SPACE` — ownerless, because the clinic profile it hangs off is a
-- single always-live row and manager publication of the attachment is the whole
-- of the control.
--
-- EVERY A5 INVARIANT IS UNTOUCHED. No byte is stored in PostgreSQL, the master
-- is still not servable, EXIF is still stripped, attaching is still drafting,
-- unpublishing still revokes at the origin on the very next request, and the
-- five-minute window remains the only cache promise this product makes.
--
-- SVG IS STILL REFUSED, AND THE BRAND MARKS ARE STILL STATIC. The accepted Vala
-- logo files stay in the web tier where a human reviewed them; nothing here
-- makes a logo staff-manageable. The Open Graph image is PHOTOGRAPHIC, which is
-- exactly why it can go through this pipeline when a logo cannot.
--
-- The section above the "HAND-WRITTEN" banner is generated by Prisma.
-- Everything below it is reviewed by a human. Each hand-written object is
-- named, and `clinic-content-schema.int-spec.ts` asserts every name exists in
-- the PostgreSQL catalogue, so a future edit cannot quietly drop one.

-- CreateEnum
CREATE TYPE "clinic_content_slot" AS ENUM ('HOME_HERO', 'HOME_CONCERN', 'HOME_FIRST_VISIT', 'HOME_FIRST_VISIT_STEP', 'ABOUT_INTRO', 'ABOUT_HIGHLIGHT', 'ABOUT_SPACE_NOTE', 'ABOUT_SPACE_POINT', 'ABOUT_JOURNEY_STEP');

-- AlterTable
ALTER TABLE "media_attachment" ADD COLUMN     "content_entry_id" UUID;

-- CreateTable
CREATE TABLE "clinic_content_entry" (
    "id" UUID NOT NULL,
    "slot" "clinic_content_slot" NOT NULL,
    "position" SMALLINT NOT NULL,
    "label" TEXT,
    "eyebrow" TEXT,
    "heading" TEXT,
    "body" TEXT,

    CONSTRAINT "clinic_content_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinic_content_entry_slot_position_key" ON "clinic_content_entry"("slot", "position");

-- CreateIndex
CREATE INDEX "media_attachment_content_entry_id_position_idx" ON "media_attachment"("content_entry_id", "position");

-- AddForeignKey
ALTER TABLE "media_attachment" ADD CONSTRAINT "media_attachment_content_entry_id_fkey" FOREIGN KEY ("content_entry_id") REFERENCES "clinic_content_entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================ HAND-WRITTEN ==================================

-- --- the block's copy -------------------------------------------------------
--
-- Each column carries the trimmed, bounded, markup-free rule every free-text
-- public column in this schema carries. `position('<' IN ...) = 0` IS THE
-- NO-MARKUP RULE, and it is why the web tier needs no sanitiser for this table:
-- markup cannot be stored, so no `<script>` can reach a renderer.
--
-- The bounds are the accepted design's own: a prompt and a heading are one
-- line, a kicker is shorter than either, and a block's paragraph is a paragraph
-- rather than an article.

ALTER TABLE "clinic_content_entry" ADD CONSTRAINT "clinic_content_entry_label_chk"
    CHECK (
        "label" IS NULL
        OR (
            "label" = btrim("label")
            AND btrim("label") <> ''
            AND length("label") <= 200
            AND position('<' IN "label") = 0
        )
    );

ALTER TABLE "clinic_content_entry" ADD CONSTRAINT "clinic_content_entry_eyebrow_chk"
    CHECK (
        "eyebrow" IS NULL
        OR (
            "eyebrow" = btrim("eyebrow")
            AND btrim("eyebrow") <> ''
            AND length("eyebrow") <= 120
            AND position('<' IN "eyebrow") = 0
        )
    );

ALTER TABLE "clinic_content_entry" ADD CONSTRAINT "clinic_content_entry_heading_chk"
    CHECK (
        "heading" IS NULL
        OR (
            "heading" = btrim("heading")
            AND btrim("heading") <> ''
            AND length("heading") <= 200
            AND position('<' IN "heading") = 0
        )
    );

ALTER TABLE "clinic_content_entry" ADD CONSTRAINT "clinic_content_entry_body_chk"
    CHECK (
        "body" IS NULL
        OR (
            "body" = btrim("body")
            AND btrim("body") <> ''
            AND length("body") <= 4000
            AND position('<' IN "body") = 0
        )
    );

-- --- the accepted design's counts, as a constraint --------------------------
--
-- THE NUMBERS BELOW ARE THE PUBLIC DESIGN'S, NOT A CAPACITY GUESS. Five is the
-- number of concern prompts the accepted home page renders; three is the number
-- of first-session moments beside them, of about-page highlights, of points
-- under the space note, and of steps from request to assessment. The remaining
-- four slots are single blocks.
--
-- With the UNIQUE (slot, position) index this makes each slot exactly as large
-- as the design says, permanently and in the database. A clinic with less to
-- say leaves a block unwritten; a clinic with more to say is a design change.
--
-- `@clinic/contracts` states the same numbers in `CLINIC_CONTENT_SLOT_SIZES`,
-- and `clinic-content-schema.int-spec.ts` asserts the two agree — so a widened
-- CHECK with an unchanged contract, or the reverse, fails a test rather than
-- producing a screen with a box the database refuses to save.
ALTER TABLE "clinic_content_entry" ADD CONSTRAINT "clinic_content_entry_slot_size_chk"
    CHECK (
        "position" >= 0
        AND "position" < CASE "slot"
            WHEN 'HOME_HERO' THEN 1
            WHEN 'HOME_CONCERN' THEN 5
            WHEN 'HOME_FIRST_VISIT' THEN 1
            WHEN 'HOME_FIRST_VISIT_STEP' THEN 3
            WHEN 'ABOUT_INTRO' THEN 1
            WHEN 'ABOUT_HIGHLIGHT' THEN 3
            WHEN 'ABOUT_SPACE_NOTE' THEN 1
            WHEN 'ABOUT_SPACE_POINT' THEN 3
            WHEN 'ABOUT_JOURNEY_STEP' THEN 3
        END
    );

-- --- the blocks themselves --------------------------------------------------
--
-- EMPTY, LIKE THE PROFILE ROW A1 INSERTED. Every copy column is NULL, so this
-- application ships knowing the SHAPE of the clinic's pages and none of their
-- words. `heading IS NULL` on all twenty-one means the public read returns
-- nothing at all until a manager writes something, which is the correct state
-- for a site whose copy has not been supplied.
--
-- The ids are `gen_random_uuid()` rather than the application's UUIDv7, because
-- nothing here is a time-ordered event: these are twenty-one fixed slots, not
-- twenty-one things that happened.

INSERT INTO "clinic_content_entry" ("id", "slot", "position")
SELECT gen_random_uuid(), s.slot, p.pos
FROM (
    VALUES
        ('HOME_HERO'::clinic_content_slot, 1),
        ('HOME_CONCERN'::clinic_content_slot, 5),
        ('HOME_FIRST_VISIT'::clinic_content_slot, 1),
        ('HOME_FIRST_VISIT_STEP'::clinic_content_slot, 3),
        ('ABOUT_INTRO'::clinic_content_slot, 1),
        ('ABOUT_HIGHLIGHT'::clinic_content_slot, 3),
        ('ABOUT_SPACE_NOTE'::clinic_content_slot, 1),
        ('ABOUT_SPACE_POINT'::clinic_content_slot, 3),
        ('ABOUT_JOURNEY_STEP'::clinic_content_slot, 3)
) AS s(slot, size)
CROSS JOIN LATERAL generate_series(0, s.size - 1) AS p(pos);

-- --- no deletion (reuses the Milestone 1 shared function) -------------------
--
-- THE SLOTS ARE THE ACCEPTED DESIGN AND ARE NOT A MANAGER'S TO REMOVE. A block
-- comes off the website by having its heading cleared — which is reversible,
-- audited, and takes its photograph with it — and never by the row ceasing to
-- exist. The TRUNCATE trigger is not optional: TRUNCATE bypasses row-level
-- triggers entirely.
--
-- Created AFTER the insert above, deliberately, so the seed is an ordinary
-- statement rather than something that has to work around its own guard.

CREATE TRIGGER "clinic_content_entry_no_delete"
    BEFORE DELETE ON "clinic_content_entry"
    FOR EACH ROW EXECUTE FUNCTION "raise_append_only_violation"();

CREATE TRIGGER "clinic_content_entry_no_truncate"
    BEFORE TRUNCATE ON "clinic_content_entry"
    FOR EACH STATEMENT EXECUTE FUNCTION "raise_append_only_violation"();

-- --- the attachment owner rule, restated over seven branches ----------------
--
-- REDEFINED RATHER THAN ADDED TO, for the reason checkpoint A7 redefined it: a
-- polymorphic reference is only as good as the constraint that pins it, and
-- every branch has to name every column or a `PUBLIC_ARTICLE` attachment could
-- quietly also carry a `content_entry_id` and two reads would disagree about
-- what it is attached to.
--
-- FIVE BRANCHES NAME EXACTLY ONE ROW AND TWO NAME NOTHING. `CLINIC_SPACE` and
-- `CLINIC_OPEN_GRAPH` are the ownerless pair — the web tier's parking slot for
-- an uploaded but unplaced photograph, and the site's own social-preview
-- picture — and neither has a publication row to read.
ALTER TABLE "media_attachment" DROP CONSTRAINT "media_attachment_owner_chk";

ALTER TABLE "media_attachment" ADD CONSTRAINT "media_attachment_owner_chk"
    CHECK (
        CASE "owner_type"
            WHEN 'THERAPIST_PROFILE' THEN
                "therapist_id" IS NOT NULL AND "article_id" IS NULL
                AND "testimonial_id" IS NULL AND "space_id" IS NULL
                AND "content_entry_id" IS NULL
            WHEN 'PUBLIC_ARTICLE' THEN
                "article_id" IS NOT NULL AND "therapist_id" IS NULL
                AND "testimonial_id" IS NULL AND "space_id" IS NULL
                AND "content_entry_id" IS NULL
            WHEN 'PUBLIC_TESTIMONIAL' THEN
                "testimonial_id" IS NOT NULL AND "therapist_id" IS NULL
                AND "article_id" IS NULL AND "space_id" IS NULL
                AND "content_entry_id" IS NULL
            WHEN 'PUBLIC_SPACE' THEN
                "space_id" IS NOT NULL AND "therapist_id" IS NULL
                AND "article_id" IS NULL AND "testimonial_id" IS NULL
                AND "content_entry_id" IS NULL
            WHEN 'CLINIC_CONTENT_ENTRY' THEN
                "content_entry_id" IS NOT NULL AND "therapist_id" IS NULL
                AND "article_id" IS NULL AND "testimonial_id" IS NULL
                AND "space_id" IS NULL
            WHEN 'CLINIC_SPACE' THEN
                "therapist_id" IS NULL AND "article_id" IS NULL
                AND "testimonial_id" IS NULL AND "space_id" IS NULL
                AND "content_entry_id" IS NULL
            WHEN 'CLINIC_OPEN_GRAPH' THEN
                "therapist_id" IS NULL AND "article_id" IS NULL
                AND "testimonial_id" IS NULL AND "space_id" IS NULL
                AND "content_entry_id" IS NULL
        END
    );
