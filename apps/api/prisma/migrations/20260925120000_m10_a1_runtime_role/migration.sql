-- Milestone 10, checkpoint A1 — THE RUNTIME ROLE AND EXACTLY WHAT IT HOLDS.
--
-- Until now the API connected as the schema owner. An owner can DROP, TRUNCATE
-- and `ALTER TABLE ... DISABLE TRIGGER`, so every append-only, immutability and
-- erase-in-place guarantee in this schema was one statement away from gone for
-- anybody who could make the API process run SQL. Every earlier migration noted
-- the gap; this one closes it.
--
-- `clinic_runtime` is a NOLOGIN role created by `prisma/provision-roles.sql`,
-- never here: roles are cluster-wide and carry passwords, and the owner that
-- runs migrations holds no CREATEROLE. The API and the operator CLI log in as a
-- member of it. It OWNS NOTHING, so it cannot alter, drop, truncate or disable a
-- trigger on any object, whatever it is granted below.
--
-- THE MATRIX IS DERIVED FROM WHAT THE APPLICATION ACTUALLY RUNS, table by table:
--
--   SELECT   every application table. Reads, RETURNING, and the lookups inside
--            the trigger functions all run as the caller.
--   INSERT   every table the application creates rows in — all of them except
--            the two whose rows are structure the migrations create
--            (`clinic_public_profile`, `clinic_content_entry`).
--   UPDATE   every table the application changes a row in or row-locks
--            (`SELECT ... FOR UPDATE` requires UPDATE). WITHHELD from the
--            append-only tables the application never changes: `audit_log`,
--            `media_rendition`, `settlement_period`, `settlement_line`, and the
--            configuration join tables that are replaced by delete-and-insert.
--            `appointment_series` holds UPDATE only because its row is locked
--            FOR UPDATE; no statement changes it, and its protection remains
--            the no-delete, no-truncate triggers.
--   DELETE   ONLY the seven tables the application physically deletes from:
--            current configuration replaced wholesale (`therapist_service`,
--            `room_service`, `service_duration`, `therapist_availability`,
--            `therapist_availability_exception`, `guardian`) and transient
--            workflow state (`registration_draft`). Every historical table —
--            money above all — refuses DELETE twice: by privilege here, and by
--            its own trigger for anybody who does hold the privilege.
--   TRUNCATE, REFERENCES, TRIGGER — never, on anything.
--   `child_file_number_seq` — USAGE only: `nextval`, never `setval`.
--   `_prisma_migrations` — nothing. The migration history is the owner's.
--
-- THE TRIGGERS AND CHECKS ARE UNCHANGED AND STILL THE AUTHORITY. Where the
-- runtime holds UPDATE on a table with immutable columns (a charge, a payment,
-- a published slug, an erased website request) it is the table's own trigger
-- that refuses the forbidden change, exactly as before — the difference is
-- that the runtime can no longer switch that trigger off.
--
-- A NEW TABLE MUST GRANT ITSELF HERE-STYLE IN ITS OWN MIGRATION. There are no
-- default privileges, deliberately: a default would hand every future table
-- the widest shape without anybody deciding it. The integration suite pins
-- this matrix, so a table added without a decision fails CI rather than
-- failing in production.

DO $$
DECLARE
  runtime pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO runtime FROM pg_roles WHERE rolname = 'clinic_runtime';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'role clinic_runtime does not exist'
      USING HINT = 'Run apps/api/prisma/provision-roles.sql as an administrator before migrating. See README, Database roles.';
  END IF;

  IF runtime.rolsuper OR runtime.rolcreaterole OR runtime.rolcreatedb
     OR runtime.rolreplication OR runtime.rolbypassrls THEN
    RAISE EXCEPTION 'role clinic_runtime holds a cluster-level attribute it must not hold';
  END IF;

  IF pg_has_role('clinic_runtime', current_user, 'MEMBER') THEN
    RAISE EXCEPTION 'clinic_runtime is, or is a member of, the migrating role %', current_user
      USING HINT = 'Migrations must run as the owner, and the runtime must not be able to become it.';
  END IF;
END
$$;

-- A clean slate for this role, so the grants below are the whole truth however
-- the database got here.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM clinic_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM clinic_runtime;
REVOKE ALL ON SCHEMA public FROM clinic_runtime;

-- Nobody but the owner creates objects in the schema. PostgreSQL 15 and later
-- already withhold this from PUBLIC; saying it keeps the guarantee independent
-- of the server version and of how the database was created.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO clinic_runtime;

-- SELECT, INSERT, UPDATE, DELETE — configuration replaced wholesale, and the
-- transient registration draft.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  registration_draft
TO clinic_runtime;

-- SELECT, INSERT, DELETE — join and availability rows replaced by
-- delete-and-insert, never updated in place.
GRANT SELECT, INSERT, DELETE ON
  therapist_service,
  room_service,
  service_duration,
  therapist_availability,
  therapist_availability_exception,
  guardian
TO clinic_runtime;

-- SELECT, INSERT, UPDATE — records with a lifecycle. Their historical and
-- financial columns are guarded by their own triggers.
GRANT SELECT, INSERT, UPDATE ON
  app_user,
  user_session,
  therapist,
  service,
  room,
  tariff,
  family,
  child,
  appointment_series,
  appointment,
  appointment_participant,
  session_charge,
  charge_adjustment,
  payment,
  payment_promise,
  therapist_share_rule,
  session_settlement,
  public_article,
  public_testimonial,
  public_space,
  website_request,
  media_asset,
  media_attachment
TO clinic_runtime;

-- SELECT, INSERT — append-only.
GRANT SELECT, INSERT ON
  audit_log,
  media_rendition,
  settlement_period,
  settlement_line
TO clinic_runtime;

-- SELECT, UPDATE — structure created by migrations, edited in place.
GRANT SELECT, UPDATE ON
  clinic_public_profile,
  clinic_content_entry
TO clinic_runtime;

GRANT USAGE ON SEQUENCE child_file_number_seq TO clinic_runtime;
