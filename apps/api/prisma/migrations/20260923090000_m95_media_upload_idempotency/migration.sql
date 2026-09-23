-- Milestone 9.5 stabilisation — A RETRIED UPLOAD IS ONE ASSET.
--
-- ADDITIVE AND NON-DESTRUCTIVE: one nullable column and one index. No existing
-- row is rewritten, no constraint is loosened, and no byte moves.
--
-- `source_content_hash` is the SHA-256 (lower-case hex) of the bytes AS
-- UPLOADED. It is the identity of the photograph a colleague sent, and it is
-- what lets a retry after an interruption — a dropped connection, a web or API
-- restart, a double click — find the asset the first attempt already created
-- instead of creating a second. It is held here, in the system of record, so
-- it survives every process restart.
--
-- IT IS A DIGEST, NOT THE PHOTOGRAPH. The uploaded bytes are still never
-- written anywhere (checkpoint A5); a digest cannot reproduce them or the GPS
-- fix a telephone embeds. What it does allow is confirmation: somebody who
-- already holds a file and can read this table can tell whether that exact
-- file was uploaded. That reader can already see the derived pictures.
--
-- NULLABLE BECAUSE THE PAST HAS NO VALUE. Assets uploaded before this migration
-- carry NULL and simply never match a retry; nothing is backfilled, because the
-- original bytes were never kept and cannot be re-hashed.
--
-- NOT UNIQUE, DELIBERATELY. The match is scoped to the uploader and to assets
-- still in circulation, so re-uploading after archiving is a new asset; a
-- unique index would make restoring the archived one fail. Concurrent retries
-- are serialised in `MediaService.upload` by a transaction-scoped advisory lock
-- on (uploader, digest) instead.
ALTER TABLE "media_asset" ADD COLUMN "source_content_hash" TEXT;

ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_source_content_hash_chk"
    CHECK ("source_content_hash" IS NULL OR "source_content_hash" ~ '^[0-9a-f]{64}$');

-- The retry lookup: this uploader, this photograph.
CREATE INDEX "media_asset_created_by_user_id_source_content_hash_idx"
    ON "media_asset"("created_by_user_id", "source_content_hash");
