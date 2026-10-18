-- M10-A10, owner decision T-010 (revised): NOBODY TYPES A WEB ADDRESS.
--
-- Every row of every public content type that has an address — `service`,
-- `therapist` (the public profile) and `public_article` — is given one by the
-- database: short, unique, URL-safe, never reused, and never changed once
-- assigned. Staff forms no longer carry the field; the API no longer accepts it.
--
-- NON-DESTRUCTIVE. Every address that exists today stays exactly as it is,
-- published or not. Rows with no address (services and therapists only; an
-- article always had one) are given one here. No row is deleted, no column is
-- dropped, and nothing published moves.
--
-- THE FORMAT: eight characters from `23456789bcdfghjkmnpqrstvwxz` — digits
-- without 0/1 and lowercase consonants without l, so nothing reads as another
-- character and no English word can form by accident. 27^8 ≈ 2.8 × 10^11
-- addresses per table. It satisfies the existing slug CHECKs
-- (`^[a-z0-9]+(-[a-z0-9]+)*$`, 2–80 characters) unchanged. The randomness is
-- taken from `gen_random_uuid()`, PostgreSQL's strong source, rather than
-- `random()`.
--
-- NEVER REUSED follows from three facts the schema already enforces and one it
-- gains here: the rows are never deleted (`*_no_delete` triggers), each table
-- has a unique index on the column, the column is now NOT NULL, and — new — an
-- address, once assigned, can never be changed or cleared. An address can
-- therefore never be released for another row to take.

-- --- the generator ----------------------------------------------------------
--
-- A candidate is drawn and checked against the named table until it is free.
-- Two concurrent inserts drawing the same eight characters is a 1-in-10^11
-- event; the unique index is the authority if it ever happens, and the insert
-- is refused rather than given a duplicate.
CREATE OR REPLACE FUNCTION "next_public_slug"(table_name text)
    RETURNS text LANGUAGE plpgsql VOLATILE AS $fn$
DECLARE
    alphabet CONSTANT text := '23456789bcdfghjkmnpqrstvwxz';
    bytes bytea;
    candidate text;
    taken boolean;
BEGIN
    IF table_name NOT IN ('service', 'therapist', 'public_article') THEN
        RAISE EXCEPTION 'next_public_slug: % has no public address', table_name;
    END IF;

    LOOP
        bytes := uuid_send(gen_random_uuid());
        candidate := '';
        -- Bytes 6 and 8 carry the UUID version and variant bits; skip them.
        FOR i IN 0..15 LOOP
            CONTINUE WHEN i IN (6, 8);
            candidate := candidate || substr(alphabet, 1 + get_byte(bytes, i) % 27, 1);
            EXIT WHEN length(candidate) = 8;
        END LOOP;

        EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE public_slug = $1)', table_name)
            INTO taken USING candidate;
        EXIT WHEN NOT taken;
    END LOOP;

    RETURN candidate;
END;
$fn$;

-- --- immutability: once assigned, for ever ---------------------------------
--
-- The rule tightens from "immutable once publicly reachable" (M9, 2026-08-21)
-- to "immutable once assigned": with no request able to name an address there
-- is no legitimate correction left to allow, and an address that could be
-- changed while private could be released and later reused. The stamp of
-- `public_first_published_at` is unchanged.
CREATE OR REPLACE FUNCTION "enforce_public_slug_stability"() RETURNS trigger AS $$
BEGIN
    IF NEW."is_public" AND NEW."public_slug" IS NOT NULL
       AND NEW."public_first_published_at" IS NULL THEN
        NEW."public_first_published_at" := transaction_timestamp();
    END IF;

    IF TG_OP = 'UPDATE' AND OLD."public_slug" IS NOT NULL
       AND NEW."public_slug" IS DISTINCT FROM OLD."public_slug" THEN
        RAISE EXCEPTION
            '%.public_slug is immutable once assigned',
            TG_TABLE_NAME
            USING ERRCODE = '23001';
    END IF;

    IF TG_OP = 'UPDATE' AND OLD."public_first_published_at" IS NOT NULL
       AND NEW."public_first_published_at" IS DISTINCT FROM OLD."public_first_published_at" THEN
        RAISE EXCEPTION
            '%.public_first_published_at is written once and never rewritten',
            TG_TABLE_NAME
            USING ERRCODE = '23001';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- --- backfill: an address for every row that has none ----------------------
--
-- One statement per row, so each draw sees the addresses assigned before it.
-- Existing addresses are not touched.
--
-- NOTHING BECOMES VISIBLE BECAUSE OF THIS MIGRATION. A Milestone 2 service may
-- be `is_public` with no address (DECISION_LOG 2026-10-16): it was never on the
-- website, because a public read needs the address. Giving it one would
-- publish it silently, so such a service is made private first; the manager
-- publishes it by ticking "public" — the ordinary, audited act. A therapist
-- cannot be public without an address (`therapist_public_profile_chk`), so no
-- therapist is affected that way.
--
-- Every row this changes gets a SYSTEM audit row in the action its manager
-- form writes, with before and after and the migration named in `metadata`.
DO $$
DECLARE
    r record;
    assigned text;
    request uuid := gen_random_uuid();
    why CONSTANT jsonb := jsonb_build_object(
        'migration', '20261018090000_m10_a10_assigned_public_addresses',
        'reason', 'T-010: the system assigns every public address'
    );
BEGIN
    FOR r IN SELECT id, is_public FROM "service" WHERE "public_slug" IS NULL ORDER BY id LOOP
        UPDATE "service"
        SET "public_slug" = next_public_slug('service'),
            "is_public" = false
        WHERE id = r.id
        RETURNING "public_slug" INTO assigned;

        INSERT INTO "audit_log" (
            id, action, actor_type, request_id, entity_type, entity_id, before, after, metadata
        ) VALUES (
            gen_random_uuid(), 'service.updated', 'SYSTEM', request, 'service', r.id,
            jsonb_build_object('publicSlug', NULL, 'isPublic', r.is_public),
            jsonb_build_object('publicSlug', assigned, 'isPublic', false),
            why
        );
    END LOOP;

    FOR r IN SELECT id FROM "therapist" WHERE "public_slug" IS NULL ORDER BY id LOOP
        UPDATE "therapist"
        SET "public_slug" = next_public_slug('therapist')
        WHERE id = r.id
        RETURNING "public_slug" INTO assigned;

        INSERT INTO "audit_log" (
            id, action, actor_type, request_id, entity_type, entity_id, before, after, metadata
        ) VALUES (
            gen_random_uuid(), 'therapist.public_profile_updated', 'SYSTEM', request,
            'therapist', r.id,
            jsonb_build_object('publicSlug', NULL),
            jsonb_build_object('publicSlug', assigned),
            why
        );
    END LOOP;
END;
$$;

-- --- every new row is given one --------------------------------------------
ALTER TABLE "service"
    ALTER COLUMN "public_slug" SET DEFAULT next_public_slug('service'),
    ALTER COLUMN "public_slug" SET NOT NULL;

ALTER TABLE "therapist"
    ALTER COLUMN "public_slug" SET DEFAULT next_public_slug('therapist'),
    ALTER COLUMN "public_slug" SET NOT NULL;

ALTER TABLE "public_article"
    ALTER COLUMN "public_slug" SET DEFAULT next_public_slug('public_article');
