-- Milestone 9, checkpoint A2 — public CONTENT, and the last public column with
-- no manager writer behind it.
--
-- A1 gave the clinic a public FACE: which services, which colleagues, which of
-- its own contact facts the world is shown. This migration adds the two things
-- the clinic WRITES for the world rather than merely exposes — articles and
-- testimonials — and one column that makes a sitemap able to tell the truth.
--
-- TWO TABLES AND ONE ENUM. That is the whole schema footprint, and the
-- shortness is the design. There is NO page table, NO block or component table,
-- NO template, NO media library, NO tag or category table, NO revision table,
-- NO scheduling table and NO analytics of any kind. PROJECT_SPEC.md 11 asks for
-- a draft/published workflow with authorised publishing, readable unique URLs,
-- and approved anonymised stories. This is that and nothing else; a content
-- management system is a product nobody has asked for.
--
-- `public_article`: WRITTEN TO BE READ, WHICH IS WHY ITS SLUG IS NOT NULL.
-- A service exists for internal reasons and later gains a public identity, so
-- A1 made its slug nullable. An article exists only to be read, so it has an
-- address from the first draft — and the A1 stability rule applies unchanged
-- through the SAME trigger function: the address may be corrected freely until
-- the first publication makes it a promise, and never afterwards.
--
-- AN ARTICLE CARRIES ITS COPY TWICE, AND THAT IS THE PUBLICATION AUTHORITY
-- ITSELF. `title`, `summary` and `body` are the WORKING DRAFT, which a
-- receptionist may edit at any time. `published_title`, `published_summary` and
-- `published_body` are WHAT THE WEBSITE SAYS, and the only statement in this
-- application that writes them is the manager-only publication act. Every
-- public read selects the second set and never the first.
--
-- WITHOUT THE SECOND SET THERE IS NO WAY TO TELL THE TRUTH HERE. One set of
-- columns forces a choice between two broken rules: either a receptionist's
-- unreviewed prose appears on the live page the instant they save it, or an
-- article cannot be revised at all once it is published. The product rule is
-- neither — a receptionist prepares a change and the page does not move until a
-- manager publishes it — and a single row of content cannot represent a live
-- version and a pending version at the same time.
--
-- THIS IS NOT THE PUBLISHED-COPY PATTERN A1 REJECTED, and the difference is
-- what would drift. A1 refused a `published_service` table because a service's
-- name IS its public name: a copy would let the site advertise something the
-- clinic had stopped offering. An article has no such second truth — the draft
-- is not a fact about the world that the published text could contradict, it is
-- an unfinished version of that text — so there is nothing for the copy to
-- disagree with. It is also two column sets on ONE row rather than a second
-- table: no revision history, no version list, no scheduling, and exactly one
-- previous state, which is the one currently on the website.
--
-- `public_slug` IS NOT DUPLICATED. It is immutable from the first publication
-- (see the stability trigger), so a draft slug and a published slug could never
-- differ on a published article, and a second copy would be a column that can
-- only ever equal the first.
--
-- `public_testimonial`: TWO STATES AND A FLAG, AND THE DATABASE ENFORCES THE
-- ORDER BETWEEN THEM. `status` is the privacy review PROJECT_SPEC.md 11
-- requires; `is_public` is placement on a page; and
-- `public_testimonial_approval_chk` refuses `is_public` on anything not
-- `APPROVED`. Approval is therefore never inferred from a record existing, and
-- an unreviewed quotation cannot reach a visitor even through a hand-written
-- UPDATE.
--
-- IT HOLDS NO IDENTITY AND NO CLINICAL FACT. There is no family id, no child
-- id, no service, no therapist, no date of treatment, no age, no diagnosis and
-- no outcome — not projected away, ABSENT. The narrowest way to obey a rule
-- about a category of data is not to hold the data, and the rule here is
-- PROJECT_SPEC.md 11: no identifying child or clinical data is published. The
-- one attribution column is `author_label`, an anonymised description a manager
-- reviews before approving it, and nullable because an unattributed quotation
-- is the safest form there is.
--
-- A TESTIMONIAL HAS NO SLUG AND NO URL. Every other published thing in this
-- product is addressable; this one deliberately is not. An addressable
-- testimonial is a page about one family — linkable, quotable, indexable on its
-- own — and a list on one page implies nothing about anybody.
--
-- `public_revised_at`, ON FOUR ROWS, IS THE SITEMAP'S LAST-MODIFIED AND NOTHING
-- ELSE. It is written by the manager write paths of this checkpoint, and it is
-- NOT a second change history: `audit_log` remains the authoritative record of
-- who changed what and when, this column is a PUBLIC fact a crawler is told,
-- and no read of it names an actor. It is nullable, and the null is honest — a
-- row published before these write paths existed genuinely has no such instant,
-- and a sitemap entry with no last-modified is a correct sitemap entry.
--
-- NO MARKUP IS STORED, ANYWHERE. Every public prose column below refuses a
-- less-than sign. Manager-written copy rendered to strangers is the exact shape
-- of a stored cross-site-scripting defect; the usual answer is a sanitiser in
-- front of the renderer, and this one is that there is nothing to sanitise. The
-- web tier can render these values as text with no `dangerouslySetInnerHTML`
-- anywhere near them.
--
-- WHAT IS STILL DELIBERATELY NOT HERE: no website request, contact message or
-- inbox table, and no consent, spam or retention column of any kind. The public
-- request form is a later checkpoint and every part of it touches personal data
-- this one does not accept.
--
-- The section above the "HAND-WRITTEN" banner is generated by Prisma.
-- Everything below it is reviewed by a human. Each hand-written object is
-- named, and `public-content-schema.int-spec.ts` asserts every name exists in
-- the PostgreSQL catalogue, so a future edit cannot quietly drop one.

-- CreateEnum
CREATE TYPE "testimonial_status" AS ENUM ('DRAFT', 'APPROVED');

-- AlterTable
ALTER TABLE "service" ADD COLUMN     "public_revised_at" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "therapist" ADD COLUMN     "public_revised_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "public_article" (
    "id" UUID NOT NULL,
    "public_slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "body" TEXT NOT NULL,
    "published_title" TEXT,
    "published_summary" TEXT,
    "published_body" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "public_first_published_at" TIMESTAMPTZ,
    "public_revised_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID NOT NULL,

    CONSTRAINT "public_article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_testimonial" (
    "id" UUID NOT NULL,
    "author_label" TEXT,
    "body" TEXT NOT NULL,
    "status" "testimonial_status" NOT NULL DEFAULT 'DRAFT',
    "approved_at" TIMESTAMPTZ,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "public_first_published_at" TIMESTAMPTZ,
    "public_revised_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID NOT NULL,

    CONSTRAINT "public_testimonial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "public_article_public_slug_key" ON "public_article"("public_slug");

-- AddForeignKey
ALTER TABLE "public_article" ADD CONSTRAINT "public_article_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_testimonial" ADD CONSTRAINT "public_testimonial_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- HAND-WRITTEN: everything below this line is reviewed, not generated.
-- ===========================================================================

-- --- the article's public identity ------------------------------------------
--
-- The same pattern the shared contract enforces and the same one A1 put on
-- `service` and `therapist`, restated rather than shared: three tables, three
-- CHECKs, one rule, and a reader of any one of them can see what it is.

ALTER TABLE "public_article" ADD CONSTRAINT "public_article_public_slug_chk"
    CHECK (
        "public_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
        AND length("public_slug") BETWEEN 2 AND 80
    );

-- --- the article's copy -----------------------------------------------------
--
-- Trimmed, bounded, and free of markup. The last of the three is the
-- load-bearing one: see the banner above.

ALTER TABLE "public_article" ADD CONSTRAINT "public_article_title_chk"
    CHECK (
        "title" = btrim("title")
        AND btrim("title") <> ''
        AND length("title") <= 200
        AND position('<' IN "title") = 0
    );

ALTER TABLE "public_article" ADD CONSTRAINT "public_article_summary_chk"
    CHECK (
        "summary" IS NULL
        OR (
            "summary" = btrim("summary")
            AND btrim("summary") <> ''
            AND length("summary") <= 400
            AND position('<' IN "summary") = 0
        )
    );

ALTER TABLE "public_article" ADD CONSTRAINT "public_article_body_chk"
    CHECK (
        "body" = btrim("body")
        AND btrim("body") <> ''
        AND length("body") <= 20000
        AND position('<' IN "body") = 0
    );

-- --- the article's PUBLISHED copy -------------------------------------------
--
-- The same three shapes again, on the three columns the website actually reads.
-- Restated rather than shared because a CHECK cannot be parameterised, and
-- because the rules that matter most are the ones a reader can see beside the
-- column they govern.

ALTER TABLE "public_article" ADD CONSTRAINT "public_article_published_title_chk"
    CHECK (
        "published_title" IS NULL
        OR (
            "published_title" = btrim("published_title")
            AND btrim("published_title") <> ''
            AND length("published_title") <= 200
            AND position('<' IN "published_title") = 0
        )
    );

ALTER TABLE "public_article" ADD CONSTRAINT "public_article_published_summary_chk"
    CHECK (
        "published_summary" IS NULL
        OR (
            "published_summary" = btrim("published_summary")
            AND btrim("published_summary") <> ''
            AND length("published_summary") <= 400
            AND position('<' IN "published_summary") = 0
        )
    );

ALTER TABLE "public_article" ADD CONSTRAINT "public_article_published_body_chk"
    CHECK (
        "published_body" IS NULL
        OR (
            "published_body" = btrim("published_body")
            AND btrim("published_body") <> ''
            AND length("published_body") <= 20000
            AND position('<' IN "published_body") = 0
        )
    );

-- THE PUBLICATION AUTHORITY, IN ONE CONSTRAINT.
--
-- A public article HAS a published title and body — so `is_public` cannot be
-- set on a row whose published copy nobody has written, and the flag alone can
-- never put a draft on the website. The title and body arrive together or not
-- at all, because they are copied in one statement; a summary is optional
-- copy, so it may be absent from a published article but may not be present
-- without one.
ALTER TABLE "public_article" ADD CONSTRAINT "public_article_published_copy_chk"
    CHECK (
        ("published_title" IS NULL) = ("published_body" IS NULL)
        AND ("published_summary" IS NULL OR "published_title" IS NOT NULL)
        AND ("is_public" IS FALSE OR "published_title" IS NOT NULL)
    );

-- The A1 invariant, on a third table. The slug is NOT NULL here, so this states
-- only the half that can still be violated: content can only have been revised
-- publicly if it has been published at all.
ALTER TABLE "public_article" ADD CONSTRAINT "public_article_public_revised_chk"
    CHECK ("public_revised_at" IS NULL OR "public_first_published_at" IS NOT NULL);

-- The A1 function, unchanged, on a third table: stamp
-- `public_first_published_at` at the first publication, and refuse any later
-- change to the slug or to the stamp. Unpublishing stays allowed; the round
-- trip — unpublish, rename, republish — stays refused, because the stamp
-- survives it.
CREATE TRIGGER "public_article_public_slug_stability"
    BEFORE INSERT OR UPDATE ON "public_article"
    FOR EACH ROW EXECUTE FUNCTION "enforce_public_slug_stability"();

-- --- the testimonial --------------------------------------------------------

ALTER TABLE "public_testimonial" ADD CONSTRAINT "public_testimonial_author_label_chk"
    CHECK (
        "author_label" IS NULL
        OR (
            "author_label" = btrim("author_label")
            AND btrim("author_label") <> ''
            AND length("author_label") <= 200
            AND position('<' IN "author_label") = 0
        )
    );

ALTER TABLE "public_testimonial" ADD CONSTRAINT "public_testimonial_body_chk"
    CHECK (
        "body" = btrim("body")
        AND btrim("body") <> ''
        AND length("body") <= 20000
        AND position('<' IN "body") = 0
    );

-- THE PRIVACY REVIEW, IN ONE CONSTRAINT.
--
-- A testimonial may be public only while it is APPROVED, and `approved_at` is
-- set exactly when it is. Withdrawing approval therefore cannot leave a
-- quotation on a public page: the same statement has to clear `is_public`, or
-- the write is refused.
ALTER TABLE "public_testimonial" ADD CONSTRAINT "public_testimonial_approval_chk"
    CHECK (
        ("status" = 'APPROVED') = ("approved_at" IS NOT NULL)
        AND ("is_public" IS FALSE OR "status" = 'APPROVED')
    );

ALTER TABLE "public_testimonial" ADD CONSTRAINT "public_testimonial_public_revised_chk"
    CHECK ("public_revised_at" IS NULL OR "public_first_published_at" IS NOT NULL);

-- A testimonial has no slug, so it needs no stability trigger. It gets the
-- publication STAMP instead, written the first time it is public, so a public
-- list can be ordered by when each quotation appeared rather than by an
-- arbitrary id.
CREATE OR REPLACE FUNCTION "stamp_first_publication"() RETURNS trigger AS $$
BEGIN
    IF NEW."is_public" AND NEW."public_first_published_at" IS NULL THEN
        NEW."public_first_published_at" := transaction_timestamp();
    END IF;

    IF TG_OP = 'UPDATE'
       AND OLD."public_first_published_at" IS NOT NULL
       AND NEW."public_first_published_at" IS DISTINCT FROM OLD."public_first_published_at" THEN
        RAISE EXCEPTION
            '%.public_first_published_at is written once and never rewritten',
            TG_TABLE_NAME
            USING ERRCODE = '23001';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "public_testimonial_first_publication"
    BEFORE INSERT OR UPDATE ON "public_testimonial"
    FOR EACH ROW EXECUTE FUNCTION "stamp_first_publication"();

-- --- no deletion, on both tables (reuses the Milestone 1 shared function) ----
--
-- Published content is WITHDRAWN, never erased — the rule every catalog and
-- financial table in this schema already follows. A deleted article is a URL
-- that answers 404 with no record of what it used to say, and a deleted
-- testimonial is a family's words disappearing with no trace that they were
-- ever approved. Both tables carry `is_public`, which is how a page is taken
-- down.

CREATE TRIGGER "public_article_no_delete"
    BEFORE DELETE ON "public_article"
    FOR EACH ROW EXECUTE FUNCTION "raise_append_only_violation"();

CREATE TRIGGER "public_article_no_truncate"
    BEFORE TRUNCATE ON "public_article"
    FOR EACH STATEMENT EXECUTE FUNCTION "raise_append_only_violation"();

CREATE TRIGGER "public_testimonial_no_delete"
    BEFORE DELETE ON "public_testimonial"
    FOR EACH ROW EXECUTE FUNCTION "raise_append_only_violation"();

CREATE TRIGGER "public_testimonial_no_truncate"
    BEFORE TRUNCATE ON "public_testimonial"
    FOR EACH STATEMENT EXECUTE FUNCTION "raise_append_only_violation"();

-- --- the sitemap's last-modified, on the two A1 tables -----------------------
--
-- Same column, same meaning, same nullability as on the two tables above. A
-- service or therapist published by A1's synthetic seeder carries NULL here and
-- correctly reports no last-modified until a manager next edits it.

ALTER TABLE "service" ADD CONSTRAINT "service_public_revised_chk"
    CHECK ("public_revised_at" IS NULL OR "public_first_published_at" IS NOT NULL);

ALTER TABLE "therapist" ADD CONSTRAINT "therapist_public_revised_chk"
    CHECK ("public_revised_at" IS NULL OR "public_first_published_at" IS NOT NULL);
