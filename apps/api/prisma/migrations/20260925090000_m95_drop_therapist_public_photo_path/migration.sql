-- Milestone 9.5 stabilisation — THE LEGACY THERAPIST PHOTOGRAPH PATH IS DROPPED.
--
-- DESTRUCTIVE FOR ANY REMAINING VALUE. `public_photo_path` was the pre-media,
-- manager-typed relative path to a file a developer placed by hand. A portrait
-- is now a media attachment (`THERAPIST_PROFILE`) and nothing else: the web
-- tier stopped reading the path at 34536957, and from this migration no API
-- read or write names it. Any value still in the column is discarded and not
-- migrated, because there is nothing to migrate it to — it names a file, not a
-- media asset, and turning it into one would be an upload nobody performed.
--
-- The column's CHECK constraint is dropped with it explicitly, so the intent is
-- readable here rather than implied by PostgreSQL's cascade.
ALTER TABLE "therapist" DROP CONSTRAINT "therapist_public_photo_path_chk";

ALTER TABLE "therapist" DROP COLUMN "public_photo_path";
