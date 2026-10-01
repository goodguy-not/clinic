# Clinic Platform

Persian RTL rehabilitation-clinic platform.

- `apps/web` — Next.js App Router: public site, internal UI, and a selective BFF.
- `apps/api` — NestJS modular monolith. Owns PostgreSQL, domain rules, transactions, and audit.
- PostgreSQL — system of record.

See [CLAUDE.md](CLAUDE.md) for the architecture boundary and non-negotiable domain rules,
[docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md) for product rules, and
[docs/DECISION_LOG.md](docs/DECISION_LOG.md) for accepted decisions.

## Prerequisites

- Node.js 24 (see [.nvmrc](.nvmrc))
- pnpm 11 — `corepack enable && corepack prepare pnpm@11.18.0 --activate`, or `npm install -g pnpm`
- Docker, for the development database

## Setup

```bash
pnpm install
```

The two applications have **separate** environment files, and this separation is
deliberate rather than cosmetic.

```bash
cp .env.example .env
```

```bash
cp apps/web/.env.local.example apps/web/.env.local
```

```bash
pnpm db:up
```

The root `.env` belongs to the NestJS API and the development database; it holds the
database connection string. `apps/web/.env.local` is loaded by Next.js and holds only what
the web tier needs. Nothing loads the root `.env` into the web application, so the database
connection string never enters the Next.js process — NestJS owns PostgreSQL
(CLAUDE.md, Architecture boundary).

Two secrets have no usable default and must be generated before anything starts. Generate
each once, then paste the **same** `INTERNAL_API_KEY` into both files:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

`INTERNAL_API_KEY` goes in both `.env` and `apps/web/.env.local`; `SESSION_COOKIE_SECRET`
goes in `apps/web/.env.local` only. Both example files ship placeholders that say
`change_me` — they are not secrets and must never be used off a development machine. See
[Environment variables](#environment-variables) for the full list.

Both applications validate their environment and fail fast. The API refuses to boot on an
invalid environment; the web application validates in `next.config.ts`, so `next build`,
`next dev` and `next start` all abort before serving a request if any required variable is
missing or malformed, naming the ones at fault. CI proves this for each of the five.

### Prisma client

`pnpm install` generates the Prisma client automatically via the API's `postinstall`, so a
fresh clone needs no extra step. Generation reads the schema only — it never connects, and
it does not require `DATABASE_URL`.

After editing `apps/api/prisma/schema.prisma`, regenerate explicitly:

```bash
pnpm --filter @clinic/api prisma:generate
```

## Running

```bash
pnpm dev:api
```

```bash
pnpm dev:web
```

| Endpoint                             | Purpose                                         |
| ------------------------------------ | ----------------------------------------------- |
| `http://localhost:3001/health`       | API liveness; does not touch the database       |
| `http://localhost:3001/health/ready` | Readiness: database and media directory; no key |
| `http://localhost:3001/health/db`    | Database reachability; needs the internal key   |
| `http://localhost:3000/api/health`   | Web health, including API reachability          |
| `http://localhost:3000/login`        | Sign in                                         |

The development database is published on host port **5433**, not 5432, so it does not
collide with a locally installed PostgreSQL.

Nobody can sign in until a first manager exists. See
[Bootstrapping the first manager](#bootstrapping-the-first-manager).

## Checks

```bash
pnpm check
```

Runs, in order: format check, lint, architecture boundary, contracts build, typecheck,
unit tests, builds. Individual steps are available as `pnpm format:check`, `pnpm lint`,
`pnpm check:boundary`, `pnpm build:contracts`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

`pnpm check` deliberately needs **no database**, so it stays runnable on a machine with
nothing but Node. The database-backed suite is separate:

```bash
pnpm test:int
```

It requires `DATABASE_URL` pointing at a disposable database — see
[Integration tests](#integration-tests). CI runs both
(see [.github/workflows/ci.yml](.github/workflows/ci.yml)), but **CI is not a gate for this
project** (owner decision, 2026-09-26): the required evidence is a local full run with its
output.

**Run the integration suite in two timezones before a milestone closes.** The production
server runs in UTC; the clinic's business time is Asia/Tehran, and every business date is
decided in Tehran explicitly in SQL (`clinic_date`, `clinic_day_start`, `clinic_moment`,
`clinic_clock_time`). So the suite must pass both with the process and the database session
in UTC — `TZ=UTC`, against a PostgreSQL whose `timezone` setting is its default `UTC` (a
container started without `TZ`) — and in local Tehran time. `clinic-time-boundaries.int-spec.ts`
additionally forces the database session into `Pacific/Kiritimati` and follows sessions
either side of Tehran midnight, at a Gregorian month end and at the Jalali new year, through
the diary, the posted charge and the session report.

## Architecture boundary

The web application must never reach the database. This is enforced mechanically, not by
convention:

- `apps/web` declares no database dependency, and ESLint blocks importing one;
- the web environment schema declares no database connection string, so there is nothing
  to connect with, and the web application has its own environment file that never
  receives one;
- CI scopes the database connection string to the only step that needs it, so web lint,
  typecheck, test and build processes never see it;
- no catch-all API route may exist — a generic proxy is forbidden.

`pnpm check:boundary` verifies these and fails the build on any violation. It scans every
hand-written file under `apps/web` — source, build configuration and environment files
alike, across `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs` and `.cjs` — and has no
per-file exemptions, so the rule cannot be documented or tested away.

## Development database

```bash
pnpm db:up
```

```bash
pnpm db:down
```

Credentials in `docker-compose.yml` are synthetic and local-only. Production secrets never
live in Git. Never use real clinic data in development, tests, seeds, or logs.

The API does not connect as the container's superuser. Provision the runtime role once,
migrate as the owner, then run the API as the runtime role — see
[Database roles](#database-roles):

```bash
docker exec -i clinic-db psql -U clinic -d postgres -v database=clinic_dev -v runtime_password=clinic_app_dev_only -f - < apps/api/prisma/provision-roles.sql
```

```bash
DATABASE_URL='postgresql://clinic:clinic_dev_only@localhost:5433/clinic_dev?schema=public' pnpm --filter @clinic/api exec prisma migrate deploy
```

Locally the container superuser `clinic` stays the owner of `clinic_dev`, because an
existing development database already has every object owned by it. `.env` names
`clinic_app`, the runtime login.

## Database roles

Milestone 10, checkpoint A1. **The API never connects as the owner of the schema.** An
owner can `DROP`, `TRUNCATE` and `ALTER TABLE ... DISABLE TRIGGER`, so every append-only,
immutability and erase-in-place guarantee in this schema would be one statement away from
gone for anybody who could make the API run SQL.

| Role             | Login | Owns                          | Used by                                                                   |
| ---------------- | ----- | ----------------------------- | ------------------------------------------------------------------------- |
| `clinic_owner`   | yes   | the database and every object | `prisma migrate deploy` only — and, in tests, the between-test reset      |
| `clinic_runtime` | no    | nothing                       | holds the grants; no password, cannot sign in                             |
| `clinic_app`     | yes   | nothing                       | member of `clinic_runtime`: the API server and every operator CLI command |
| `clinic_backup`  | yes   | nothing                       | member of `pg_read_all_data` only: `scripts/backup/backup.sh`             |

`clinic_runtime` is referenced by name in migrations; the two login names are conventions.
A second login — say a separately attributable one for the CLI — needs only
`GRANT clinic_runtime TO <login>`.

### What each process connects as

| Process                                                      | `DATABASE_URL` names |
| ------------------------------------------------------------ | -------------------- |
| `prisma migrate deploy` / `migrate status` / `migrate diff`  | `clinic_owner`       |
| API server (`node dist/main.js`)                             | `clinic_app`         |
| `cli bootstrap-manager`, `cli reset-password`                | `clinic_app`         |
| `cli purge-website-requests` (the ninety-day erase-in-place) | `clinic_app`         |
| `cli run-jobs` (the nightly jobs, Milestone 10 A3)           | `clinic_app`         |
| Synthetic clinic seeder (development only)                   | `clinic_app`         |
| Integration tests — the API under test                       | `clinic_app`         |
| Integration tests — the reset (`TEST_OWNER_DATABASE_URL`)    | `clinic_owner`       |
| `scripts/backup/backup.sh` (`BACKUP_DATABASE_URL`)           | `clinic_backup`      |
| `scripts/backup/restore.sh` into an empty database           | `clinic_owner`       |

Every CLI command runs through the same NestJS services as the API and needs nothing the
API does not. The nightly jobs (Milestone 10, checkpoint A3; [Scheduled jobs](#scheduled-jobs))
added exactly two privileges, each narrowed by a trigger to the one act a job performs:
`DELETE` on `user_session` (only sessions over for thirty days) and `UPDATE` on
`media_rendition` (only the erasure of a photograph that is due).

### The privilege matrix

Migration `20260925120000_m10_a1_runtime_role` grants, derived from the statements the
application actually runs, as widened by `20260926090000_m10_a3_scheduled_jobs_and_erasure`
for the nightly jobs:

| Privileges                  | Tables                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SELECT, INSERT              | `audit_log`, `settlement_period`, `settlement_line` — append-only                                                                                                                                                                                                                                                                                                                                                                   |
| SELECT, UPDATE              | `clinic_public_profile`, `clinic_content_entry`, `scheduled_job` — rows created by migrations                                                                                                                                                                                                                                                                                                                                       |
| SELECT, INSERT, DELETE      | `therapist_service`, `room_service`, `service_duration`, `therapist_availability`, `therapist_availability_exception`, `guardian` — replaced by delete-and-insert                                                                                                                                                                                                                                                                   |
| SELECT, INSERT, UPDATE, DEL | `registration_draft` — transient, consumed and removed; `user_session` — DELETE only of a session over for 30 days (trigger)                                                                                                                                                                                                                                                                                                        |
| SELECT, INSERT, UPDATE      | every other table: users, catalog, families and children, appointments and series, charges, adjustments, payments, promises, share rules, ratings, public content, website requests, media assets and attachments; `media_rendition`, whose only permitted UPDATE is the erasure of a due photograph (trigger). Their immutable columns stay guarded by their own triggers; `appointment_series` holds UPDATE only for `FOR UPDATE` |
| USAGE                       | `child_file_number_seq` — `nextval`, never `setval`                                                                                                                                                                                                                                                                                                                                                                                 |
| nothing                     | `_prisma_migrations`; `TRUNCATE`, `REFERENCES` and `TRIGGER` on anything; `CREATE` on the schema or database; `TEMPORARY`                                                                                                                                                                                                                                                                                                           |

So every historical table — money above all — refuses `DELETE` twice: by privilege for the
runtime, and by its own trigger for anybody who does hold the privilege. Where the runtime
may `UPDATE` a table with immutable columns (a charge, a payment, a published slug, an
erased website request), the table's own trigger still refuses the forbidden change, exactly
as before; the difference is that the runtime can no longer switch it off.
`runtime-role.int-spec.ts` pins this matrix exactly and proves, from the API's own
connection, that DDL, `TRUNCATE`, disabling or dropping any trigger or constraint,
`session_replication_role`, `SET ROLE` to the owner and every domain-forbidden `DELETE` are
refused.

**Adding a table:** grant it in the same migration that creates it, and add it to
`EXPECTED_TABLE_PRIVILEGES` with its reason. There are deliberately no default privileges —
a default would hand every future table the widest shape without anybody deciding it — so a
table added without a decision fails CI rather than failing in production.

### Provisioning a deployment

Once per cluster and database, by whoever administers PostgreSQL (a superuser or a
`CREATEROLE` administrator), **before** the first migration. Passwords arrive as psql
variables, typed or piped from the deployment's secret store — never written into the
repository, a migration or a committed file:

```bash
psql -h <host> -U <administrator> -d postgres -v database=<database> -v owner_password=<secret> -v runtime_password=<secret> -f apps/api/prisma/provision-roles.sql
```

It creates `clinic_owner` (`NOSUPERUSER`, `NOCREATEROLE`), the database owned by it,
`clinic_runtime` (`NOLOGIN`) and `clinic_app`, and revokes `CONNECT` and `TEMPORARY` on
the database from `PUBLIC`. Re-running it is safe and is how a password is rotated. Then:

1. migrate as the owner — `DATABASE_URL=<clinic_owner URL> prisma migrate deploy`. The
   runtime migration refuses to run if `clinic_runtime` is missing, holds a cluster
   attribute, or could become the migrating role;
2. give the API and CLI processes the `clinic_app` URL, and no other. The owner's URL
   belongs only to the migration step's environment.

A PostgreSQL 13 or later server is required (`btree_gist` must be a trusted extension so a
non-superuser owner can create it). Managed services whose "admin" user is not a superuser
work unchanged.

## Backup and restore

Milestone 10, checkpoint A2. **The database and the media directory are backed up
together or not at all, a backup is only trusted once a restore of it has been
verified, and a restore only accepts an archive this clinic's server produced.**
`scripts/backup/drill.sh` proves the whole cycle on every CI run (the `restore-drill`
job).

**Owner decisions** (DECISION_LOG, 2026-09-26): a backup **every night**, kept **30
days**, on the server and on a **clinic computer that collects them automatically**,
plus a **monthly copy to an external drive** kept by the manager. Cloud object storage
may be added before public launch, as configuration.

**Assumed:** the server is Linux with systemd and OpenSSH; the clinic computer is
Windows 10 or 11 with the built-in OpenSSH client. Neither is decided by the hosting
choice yet.

### What one backup is

`backup.sh` writes one file, `clinic-backup-<UTC time>.tar.gpg`, plus a `.sha256`
beside it for checking a copy without the key. The file is **signed by the server's
own key and encrypted to the owner's key**. Inside the encryption:

| Member                   | What it is                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `FORMAT`                 | `clinic-backup/1`                                                                                                             |
| `database.dump`          | `pg_dump --format=custom` of the whole database, including `_prisma_migrations`, every trigger, constraint and grant          |
| `manifest/meta.txt`      | snapshot time, database, server and pg_dump versions, latest migration, backup login, encryption and signing key fingerprints |
| `manifest/tables.txt`    | every table's row count and a row-order-independent checksum of its contents                                                  |
| `manifest/sequences.txt` | every sequence's position                                                                                                     |
| `manifest/schema.txt`    | every trigger (and whether it is enabled), constraint, index, function (body digest, pinned settings) and non-owner privilege |
| `manifest/media.sha256`  | every stored file a row refers to, with the SHA-256 recorded in that row                                                      |
| `media/`                 | exactly those files, at their storage keys                                                                                    |

**Why the pair is consistent.** One `REPEATABLE READ` snapshot is exported,
`pg_dump --snapshot` reads it, and the manifest is computed in the same snapshot —
so the file list is exactly what the dumped rows refer to. The API writes a file
before the row naming it commits, so each listed file already exists; the one thing
that deletes a stored file — the nightly media erasure — must first take an advisory
lock the backup holds from before its snapshot until its last file is copied, so each
listed file still exists when it is copied ([Media erasure never breaks a
backup](#media-erasure-never-breaks-a-backup)); the script then **checks**
that, copying each one and comparing its hash with its row. A missing or altered
file stops the backup before anything is written. Files no committed row names
(a failed or in-flight upload) are not archived: they are not part of any
restorable state.

**Encryption.** To the owner's OpenPGP **public** key. The server never holds the
private key, so neither it, the clinic computer, the external drive nor anybody who
copies any of them can read a backup.

**Authenticity.** Anybody with the owner's public key can encrypt a file to it, so
encryption proves nothing about where an archive came from. Every archive is also
**signed** with a key that exists only on the server, and `restore.sh` refuses any
archive without a good signature from the key in `RESTORE_SIGNER_KEY_FILE` — the
server's _public_ signing key, kept off-server with the decryption key. A file
planted on the clinic computer or the external drive, even correctly encrypted, is
refused before anything is restored.

### Configuration

Environment only, from a file only `root` and the backup user can read.

| Variable                    | Required | Purpose                                                                                                                     |
| --------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| `BACKUP_DATABASE_URL`       | yes      | The `clinic_backup` login. The script refuses any login that could write, own, create or become another.                    |
| `MEDIA_STORAGE_DIR`         | yes      | The API's media root, read only.                                                                                            |
| `BACKUP_DESTINATION_DIR`    | yes      | The server's local backup directory. Never created by the script.                                                           |
| `BACKUP_RECIPIENT_KEY_FILE` | yes      | The owner's public key file. A file holding a private key is refused.                                                       |
| `BACKUP_SIGNING_KEY_DIR`    | yes      | A GnuPG home holding exactly one secret key: the server's signing key.                                                      |
| `BACKUP_RETENTION_DAYS`     | yes      | `30`. After a successful backup, archives in the destination older than this are removed.                                   |
| `BACKUP_WORK_DIR`           | no       | Where the plaintext staging directory is made (default `$TMPDIR`). Removed on exit; needs room for one dump plus the media. |

Requirements on the host: bash, PostgreSQL client tools **16 or later and at least the
server's major version**, GnuPG 2.2+, GNU tar and coreutils.

### Setting up the server

Users and directories (names are the defaults the systemd units use):

| What                                   | Owner : group                    | Mode   | Who can do what                                                      |
| -------------------------------------- | -------------------------------- | ------ | -------------------------------------------------------------------- |
| `clinic-backup` (system user)          | member of the API's group        | —      | runs `backup.sh`; reads the media; writes the backup directory       |
| `clinic-collector` (system user)       | its own group, `clinic-collect`  | —      | key-only SSH login for the clinic computer; no password, no DB       |
| `/var/backups/clinic`                  | `clinic-backup : clinic-collect` | `2750` | the archives (`0640`): the collector can read, never write or delete |
| `/var/lib/clinic-backup/signing-gnupg` | `clinic-backup`                  | `0700` | the server's signing key                                             |
| `/var/lib/clinic/backup-status`        | `clinic-collector : <API group>` | `2750` | the collector writes its acknowledgement; the API reads it           |

The collector login has no database role, is not in the API's group (so it cannot
read the media), and cannot write to the backup directory: even if it escaped its
forced command it could not delete or alter a backup.

1. **Provision the backup login** (once; needs a superuser, or an administrator
   holding `pg_read_all_data WITH ADMIN OPTION`). Re-running rotates its password:

   ```bash
   psql -h <host> -U <administrator> -d postgres -v database=<database> -v runtime_password=<secret> -v backup_password=<secret> -f apps/api/prisma/provision-roles.sql
   ```

   `clinic_backup` is a member of `pg_read_all_data` only — `SELECT` and schema
   `USAGE`, never a write — and its sessions are read-only by default.

2. **The owner's key pair** — on a trusted computer that is **not** the server, with
   a passphrase. Only the public half goes to the server:

   ```bash
   gpg --quick-gen-key "Clinic backups" default default never
   ```

   ```bash
   gpg --armor --export "Clinic backups" > clinic-backup-public.asc
   ```

3. **The server's signing key** — on the server, as `clinic-backup`, with no
   passphrase (it must sign unattended), then its **public** half is exported and
   handed to the owner to keep with the decryption key:

   ```bash
   gpg --homedir /var/lib/clinic-backup/signing-gnupg --batch --passphrase '' --quick-gen-key "Clinic server backup signing" ed25519 sign never
   ```

   ```bash
   gpg --homedir /var/lib/clinic-backup/signing-gnupg --armor --export > clinic-server-signing-public.asc
   ```

4. **Run once by hand** and keep the output: `scripts/backup/backup.sh`.

5. **Nightly.** Install `scripts/backup/systemd/clinic-backup.service` and
   `clinic-backup.timer` in `/etc/systemd/system/`, adjust the paths, then
   `systemctl enable --now clinic-backup.timer`. The timer runs at 02:30 Tehran time,
   and `Persistent=true` runs a missed backup at the next boot. A failure exits
   non-zero with the reason on stderr (`journalctl -u clinic-backup`); the manager
   sees the consequence as a stale off-site copy within three days (below).

### The clinic collector

The clinic computer **pulls**: it is behind the clinic's router and is not always on,
so the server cannot reach it, and a pull needs no inbound port at the clinic.

**On the server**, once:

1. Put the collector's public key (printed by the Windows install, below) in
   `~clinic-collector/.ssh/authorized_keys`, exactly as one line:

   ```text
   restrict,command="env BACKUP_DESTINATION_DIR=/var/backups/clinic BACKUP_STATUS_DIR=/var/lib/clinic/backup-status /srv/clinic/scripts/backup/collector-serve.sh" ssh-ed25519 AAAA... clinic-collector@<computer>
   ```

2. Pin the same restriction in `sshd_config`, so a key added later without it is
   still forced:

   ```text
   Match User clinic-collector
       AuthenticationMethods publickey
       DisableForwarding yes
       PermitTTY no
       ForceCommand env BACKUP_DESTINATION_DIR=/var/backups/clinic BACKUP_STATUS_DIR=/var/lib/clinic/backup-status /srv/clinic/scripts/backup/collector-serve.sh
   ```

`collector-serve.sh` answers exactly three requests — `list`, `get <archive>`, `ack
<archive>` — and refuses everything else, including any name that is not a generated
archive name.

**On the clinic computer**, once, as Administrator (clinic staff do nothing,
before or after). Read the server's host key fingerprint on the server first
(`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`), then:

```powershell
.\scripts\backup\collector\install-collector.ps1 -Server <server address> -HostKeyFingerprint 'SHA256:<from the server>' -ManagerAccount '<manager Windows account>'
```

It creates the key and settings in `%ProgramData%\ClinicBackupCollector` (SYSTEM and
Administrators only), pins the host key, and registers a scheduled task that runs as
SYSTEM two minutes after every start-up and every hour while the computer is on —
signed in or not — and catches up on missed runs. Each run downloads any backup it
lacks to `<name>.partial`, checks its SHA-256, renames it into `C:\ClinicBackups`,
tells the server the newest one it holds, and removes its own copies older than 30
days (never the newest). Interrupted or repeated runs are harmless. Its log is
`C:\ClinicBackups\collector.log`.

**Monthly, the manager** copies the newest `clinic-backup-*.tar.gpg` from
`C:\ClinicBackups` to the external drive, **replacing** last month's, and keeps the
drive away from the clinic.

### When the off-site copy is stale

`GET /operations/backup-status` (manager-only, `user.read`; no new permission) reports
how old the newest backup the clinic computer holds is, measured from when that backup
was **taken** — so a server that stopped backing up and a computer that stopped
collecting both show as the same warning. More than **72 hours** is `STALE`; no
collector configured, nothing collected yet, or an unreadable status are warnings
too. The API reads one file, `$BACKUP_STATUS_DIR/offsite-collection`, and nothing
else. The dashboard banner is the web tier's
(`docs/M10_A2_BACKUP_STATUS_WEB_HANDOFF.md`).

### What must be kept off the server

In plain words, for the owner:

| What                                                                     | Who keeps it                   | Copies                                         | If it is lost                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------ | ------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **The backup key** (the private key file)                                | the owner                      | 2, in two different places (not at the clinic) | **Every backup becomes unreadable, forever.** Nobody — not the developers — can recover it. Make a new key and keep backing up; everything before is gone. If it is **stolen together with its passphrase**, anybody holding a backup can read it: make a new key at once.           |
| **The key's passphrase**                                                 | the owner                      | 2, stored apart from the key                   | Same as losing the key.                                                                                                                                                                                                                                                              |
| **The server's public signing key** (`clinic-server-signing-public.asc`) | the owner, with the backup key | 2, with the two copies of the key              | A restore refuses every archive, because it cannot confirm they came from the clinic's server. It is not secret: re-export it from the server if the server still exists; if the server is gone too, backups cannot be restored without a developer deliberately removing the check. |
| **The clinic computer's backups** (`C:\ClinicBackups`)                   | automatic                      | the last 30 days                               | The server still has its own 30 days, and the drive has one monthly copy. The manager sees a stale warning within three days.                                                                                                                                                        |
| **The external drive**                                                   | the manager                    | 1, replaced monthly                            | Only the monthly fallback is lost. It is encrypted: a lost or stolen drive reveals nothing without the backup key. Tell the owner.                                                                                                                                                   |

Nothing else is needed to restore: database passwords, the internal API key and the
cookie secret are created fresh on the new server.

### Restoring (runbook)

Into an **empty** environment only — a replacement server, or a fresh database and
media directory beside the old ones. `restore.sh` refuses a database that holds
anything and a media directory that is not empty, so it cannot merge into or
overwrite a live system.

1. **Take the newest archive** from wherever it survives — the server, the clinic
   computer, the external drive.
2. **Use the release that took the backup.** `manifest/meta.txt` names its latest
   migration; `verify.sh` refuses when the checkout's migrations differ. Upgrade only
   after the restore is verified. Install dependencies (`pnpm install
--frozen-lockfile`) and build as for a deployment.
3. **Provision roles and an empty database**, exactly as for a new deployment, with
   new passwords ([Provisioning a deployment](#provisioning-a-deployment)). Do
   **not** run `prisma migrate deploy` — the migration history comes from the backup.
4. **Make the two off-server keys available**: import the backup key into the
   operator's GnuPG (or point `GNUPGHOME` at a keyring holding it) and copy the
   server's public signing key file. Remove the private key from this machine
   afterwards.
5. **Restore**, as the user the API will run as (so the media files are its own):

   ```bash
   RESTORE_OWNER_DATABASE_URL=<clinic_owner URL> RESTORE_RUNTIME_DATABASE_URL=<clinic_app URL> MEDIA_STORAGE_DIR=<new, empty media root> RESTORE_SIGNER_KEY_FILE=<clinic-server-signing-public.asc> scripts/backup/restore.sh <archive>
   ```

   It checks the target is empty, decrypts the whole archive and checks its
   signature and contents, restores the database **in one transaction** (complete
   or not at all) and copies the media, then runs `verify.sh`. It must end with
   `RESTORE VERIFIED`. Any failure after the database step means: discard this
   target and start again from step 3.

6. **Re-apply erasures that happened after the backup was taken** — the backup
   still holds website requests, photographs and testimonials the nightly jobs have
   since erased. Run every job once; each one is safe to run at any time:

   ```bash
   pnpm --filter @clinic/api exec node dist/cli/main.js run-jobs
   ```

   It must print four `SUCCEEDED` lines. A testimonial withdrawal recorded after the
   backup was taken is not in it: ask the manager to record it again.

7. **Start the API**, and check it is ready — the database answers and the media
   directory takes a write — with no credential:

   ```bash
   curl -fsS http://127.0.0.1:<API_PORT>/health/ready
   ```

   It must answer `{"status":"ok","checks":{"database":"ok","media":"ok"}}`. **Then
   build and start the web** against it. Public listing pages
   are prerendered at build time and revalidated every fifteen minutes; a web built
   while the API was unreachable shows empty listings until then.

8. **Check the live site** — every public page within two links of the home page
   answers, every image they reference is served, and a colleague can sign in, reach
   the dashboard and sign out (a real, audited sign-in; the password is read from
   stdin):

   ```bash
   VERIFY_WEB_URL=<site origin> VERIFY_STAFF_USERNAME=<username> node scripts/backup/verify-site.mjs
   ```

   Set `VERIFY_MIN_PUBLIC_IMAGES=0` only for a clinic with no published photograph.

9. **Set the new server up as in [Setting up the server](#setting-up-the-server)** —
   with a new signing key, whose public half replaces the old one off-server (keep
   the old one too, for older archives) — and re-point the clinic computer
   (`install-collector.ps1` again, with the new host key).
10. Point traffic at the restored system. Record the archive, the time and both
    verification outputs.

**What `verify.sh` proves** (it can be re-run against the same archive until the
restored system takes its first request, because it compares records exactly):
`prisma migrate status` and `migrate diff` report the schema in sync; every table's
count and checksum, every sequence, every trigger with its enabled state, every
constraint, index, function and grant equal the backup's; every file the restored
rows refer to is on disk with its recorded hash; every object is owned by the
non-superuser owner; and, from the API's own login, `TRUNCATE`, deleting a payment
or a charge, disabling a trigger, `session_replication_role`, `SET ROLE` to the owner,
DDL and touching the migration history are all refused, while the owner's delete of an
audit row is refused by its trigger.

### How much can be lost

- **Normally, one day.** The backup runs at 02:30 and the clinic computer collects it
  when it is next on. Losing the server loses everything entered since the last
  backup the clinic computer holds: up to about 24 hours, plus however long the
  computer stayed off after that night.
- **At most three days before somebody is told.** Past 72 hours the manager is warned.
  Beyond that the window grows for as long as the warning is ignored.
- **If the server and the clinic computer are lost together** (both on-site, a fire):
  up to **one month**, from the external drive — longer if the monthly copy was missed.
- **Mistakes, not disasters:** a wrong change noticed later can be recovered from any
  of the last 30 nightly backups, into a separate environment.

There is no point-in-time recovery (WAL archiving): nothing between two nightly
backups can be recovered.

### How big it gets

Every nightly backup is a **full** copy, so its size is the whole database plus every
stored photograph. Measured here (synthetic data, compressed as the backup stores it):

- **Records:** about **0.45 KB per appointment** with its charges, payments and audit
  rows, plus 0.26 MB of schema. A clinic with 30 appointments a day, six days a week,
  adds about **4 MB a year** — say **10 MB** allowing for richer use than the
  synthetic data.
- **Photographs:** each upload is stored as a master and twelve renditions, about
  **2.4 MB** for a telephone photograph (measured on a synthetic 12-megapixel image;
  real photographs are usually smaller). These are publicity photographs — portraits,
  rooms, articles — not clinical ones: perhaps **50–150 a year**, **125–375 MB**.

| After                        | One nightly backup | Server, 30 days (+ one in staging) | Clinic computer, 30 days | Downloaded per night |
| ---------------------------- | ------------------ | ---------------------------------- | ------------------------ | -------------------- |
| launch (≈ 30 photographs)    | ~ 80 MB            | ~ 2.5 GB                           | ~ 2.4 GB                 | ~ 80 MB              |
| one year (≈ 180 photographs) | ~ 450 MB           | ~ 14 GB                            | ~ 13.5 GB                | ~ 450 MB             |

Provision **at least 25 GB** for backups on the server and on the clinic computer for
the first year, and check again after it: the photographs are what grows. The nightly
download is the whole backup; if the clinic's connection cannot carry it, that is the
trigger to revisit (DECISION_LOG).

### Retention and privacy

A backup keeps everything as it was when it was taken, including what the system
later erases:

- A website request is erased in place ninety days after it is closed (unless it
  became a family). Every backup taken before that erasure still holds it until the
  backup is removed: **30 days** on the server and the clinic computer, and **up to
  about a month** on the external drive, whose copy is replaced monthly. So a request's
  content can survive about **four months** after it was closed, not three.
- The same holds for erased photographs (thirty days after upload if never attached,
  thirty days after archiving) and erased testimonials (within seven days of a
  withdrawal): each can survive in backups for up to 30 more days, about a month on the
  external drive — and for every correction's previous value.
- A restore brings erased content back until `run-jobs` runs again, which is why the
  runbook runs it before the system is used.

The owner has decided the privacy notice states the backup retention alongside the
ninety days; the wording is the owner's.

### The drill

```bash
DRILL_SOURCE_ADMIN_URL=<superuser URL, throwaway cluster> DRILL_TARGET_ADMIN_URL=<superuser URL, a second throwaway cluster> DRILL_WORK_DIR=<empty scratch directory> scripts/backup/drill.sh
```

After `pnpm build:contracts` and `pnpm --filter @clinic/api build`; needs PowerShell
(`pwsh`, or Windows PowerShell) for the collector. It builds a synthetic clinic with
uploaded images through the real API and CLI, backs it up, has the Windows collector
fetch it through the real forced command (SSH itself is replaced by a local
stand-in), **destroys the server** — database, roles, media and its own backups —
provisions an empty target as a new deployment, restores **from the clinic
computer's copy**, verifies, and runs the site check against the restored system.
It also proves these are refused loudly: a backup as the owner or as the runtime
login; a backup while a referenced image is missing; seven requests the collector key
may not make, with the server's backups byte-for-byte unchanged; the wrong private
key; a damaged archive; a **planted archive, correctly encrypted but unsigned**; a
**planted archive signed by another key**; a signed archive missing a referenced
image; an image lost after restore; and a restore over a database that is not empty.
Synthetic data only; every password and key is generated for the run.

### Limits

- **The signing key is on the server.** An attacker who controls the server can sign
  a forged archive; the signature proves an archive came from the clinic's server,
  not that the server was healthy.
- The staging directory holds one plaintext dump plus the referenced media while a
  backup runs, on the same server that already holds both.
- The database is read while the clinic works; the snapshot is consistent, and
  PostgreSQL holds only `ACCESS SHARE` locks, so the only thing it blocks is DDL —
  do not deploy a migration during a backup.
- The external drive's copy is manual; nothing records whether it was made.

## Scheduled jobs, health and logging (Milestone 10, checkpoint A3)

### Scheduled jobs

Four jobs keep promises nobody should have to remember. `cli run-jobs` runs them in this
order, one line per job, counts only:

| Job                     | What it does                                                                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WEBSITE_REQUEST_PURGE` | the ninety-day erase-in-place of closed, never-linked website requests (Milestone 9, A4)                                                                               |
| `SESSION_PRUNE`         | deletes staff sessions that ended (expired or revoked) more than 30 days ago                                                                                           |
| `TESTIMONIAL_ERASURE`   | for each testimonial whose family withdrew consent: erases the words and attribution, and the bytes of every photograph ever attached to it (owner: within seven days) |
| `MEDIA_ERASURE`         | erases the bytes of a photograph never attached for 30 days, or archived for 30 days (owner decision); then removes anything an interrupted erasure left on disk       |

**Owner decisions** (DECISION_LOG, 2026-09-26): never attached — erased after 30 days;
archived — restorable for 30 days, then erased; testimonial consent withdrawn — the
manager takes it off the site at once (`POST /content/testimonials/:id/consent-withdrawal`),
and the words and photographs are erased within seven days.

**What erasure leaves.** The row, in the `website_request` pattern: the library still lists
an erased photograph with `bytesPurgedAt`, and it can no longer be attached, published or
restored (`MEDIA_NOT_FOUND`); a withdrawn testimonial is gone from every staff read, and
`GET /content/testimonials/consent-withdrawals` lists withdrawals by date only. The audit
trail has `media.bytes_erased` (with the rule), `public_testimonial.consent_withdrawn` and
`public_testimonial.content_erased` — never the content. The database refuses an erasure that
is not due, and makes erasure and withdrawal final.

**Safe to run twice**, concurrently or after a crash: every job re-checks each row under a
lock, and what it has done no longer matches. `--dry-run` prints how much each job would do
and writes nothing; `--only <JOB>` runs one.

**Least privilege.** The jobs run as the API's OS user and `clinic_app`, through the same
services as the API. They added `DELETE` on `user_session` and `UPDATE` on
`media_rendition` to `clinic_runtime`, each narrowed by a trigger (see [Database
roles](#database-roles)), and `SELECT, UPDATE` on `scheduled_job`.

**Setting up the server.** Install `scripts/ops/systemd/clinic-jobs.service` and
`clinic-jobs.timer` in `/etc/systemd/system/`, adjust the user, paths and environment file
to the API's, then `systemctl enable --now clinic-jobs.timer`. It runs at 04:15 Tehran
time, after the 02:30 backup; `Persistent=true` runs a missed night at boot. Run it once by
hand first (`systemctl start clinic-jobs` and `journalctl -u clinic-jobs`). A failed job
exits non-zero.

**The manager sees it.** Each job that finishes all of its work records when
(`scheduled_job.last_succeeded_at`, and a `scheduled_job.succeeded` audit row). `GET
/operations/job-status` (`user.read`, manager-only) reports each job as `OK`, `STALE` (no
success for 48 hours) or `NEVER_RUN`, beside the backup status; the dashboard banner is the
Web's (`docs/M10_A3_WEB_HANDOFF.md`).

### Media erasure never breaks a backup

`backup.sql` takes `pg_advisory_lock_shared(4919, 10)` before its snapshot and holds it until
`copy-media.sh` — run inside the same session — has copied the last file. An erasure takes
the same lock exclusively before changing a row and commits while holding it, then unlinks
the files. So no erasure commits while a backup could need its files, and later backups never
look for them. If a backup is running, the job waits up to 30 minutes, then leaves the rest
for the next night — that run is `INCOMPLETE` and not a success, so a job that keeps
colliding shows as `STALE`.

### Health checks

| Route               | Credential   | Answers                                                                                |
| ------------------- | ------------ | -------------------------------------------------------------------------------------- |
| `GET /health`       | none         | liveness: the process is up (uptime only)                                              |
| `GET /health/ready` | none         | `200` or `503`, `{"status","checks":{"database","media"}}`, each `ok` or `unavailable` |
| `GET /health/db`    | internal key | database reachability with latency, for the Web tier                                   |

Readiness runs `SELECT 1` (2-second timeout) and writes and removes one probe file in the
media root, which it never creates; concurrent probes share one check, reused for 2 seconds.
It reveals no path, version, latency or error text — a failure's kind goes to the log, once
per change of state. The deployment and restore runbooks, and the drill, use it.

### Logging

**Production logs carry no personal data, no request bodies, no photo descriptions or file
names and no session tokens.** What is logged today:

| Where                                   | What                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| `ErrorEnvelopeFilter`, 5xx only         | request id, the error's class, driver code, SQLSTATE, constraint name; stack frames |
| `SecurityLog` (rejections, not audited) | event, reason, request id — no username, no address                                 |
| Readiness, DB health, backup status     | which check failed and the error's kind                                             |
| Start-up                                | the port; an invalid environment names variables, never values                      |
| CLI (`run-jobs` and the others)         | counts; an error's kind                                                             |

**An unexpected error's message is never logged** (`describe-error.ts`): PostgreSQL puts
row values in it, Prisma puts call arguments in it, a parse error quotes the body. Find a
production error by its request id, which the user sees and the audit row carries.
`log-hygiene.int-spec.ts` and `describe-error.spec.ts` pin this.

**Rotation.** Every process runs under systemd and logs to the journal. Install
`scripts/ops/systemd/journald-clinic.conf` as `/etc/systemd/journald.conf.d/clinic.conf`
and restart `systemd-journald`: at most 1 GB, at most one month.

## Authentication and audit (Milestone 1)

### Where the boundary sits

The browser talks only to Next.js. Next.js owns browser cookies, CSRF plumbing and
Persian error mapping. NestJS owns users, sessions, authentication decisions,
authorization, audit writes, database access and transactions.

```text
browser ──cookies──> Next.js ──x-internal-key────> NestJS ──> PostgreSQL
                              x-request-id
                              x-session-id (only after the cookie signature verifies)
                              x-client-ip / x-client-user-agent
```

**NestJS never trusts an identity claim from the web tier.** `x-user-id`, `x-user-role`,
`x-permissions` and `authorization` are read nowhere in `apps/api`. Identity comes from one
place: hash the opaque token in `x-session-id`, look it up in `user_session`, join
`app_user`. Role, status and permissions are re-resolved on every request, so a demotion,
a disable or a revocation takes effect on the very next call with no cached claim to
invalidate.

The outbound header set is built from scratch in `apps/web/src/server/api-client.ts`, which
accepts **no header bag**. There is no parameter through which a browser-supplied header
could be forwarded, so the rule holds by function signature rather than by review.

### Sessions

NestJS generates a 32-byte random token and stores **only its SHA-256 hash**, so a leaked
backup or query log yields nothing replayable. Next signs the token into a versioned opaque
cookie (`v1.<payload>.<HMAC-SHA256>`) verified with a timing-safe comparison. That signature
is defence in depth; the authoritative check is always the database lookup.

- rolling idle expiry **8 h**, absolute cap **12 h**, the cap enforced by a `CHECK` so no
  renewal bug can exceed it;
- `last_seen_at` is rewritten at most once per **5 minutes**;
- if a stale-session renewal affects zero rows, the request re-reads once and is rejected if
  the session is no longer valid — the pre-renewal snapshot is never used;
- every timestamp and expiry comparison is computed by PostgreSQL: `transaction_timestamp()`
  for facts that must agree with their audit row, `clock_timestamp()` for liveness;
- `cookieMaxAgeSeconds` is computed **in SQL** and used verbatim by Next, so the web tier
  never becomes a second security clock.

### Cookies and CSRF

|          | `DEPLOYMENT_MODE=production` | `non-production`     |
| -------- | ---------------------------- | -------------------- |
| session  | `__Host-clinic_session`      | `clinic_session_dev` |
| CSRF     | `__Host-clinic_csrf`         | `clinic_csrf_dev`    |
| `Secure` | always                       | no                   |

`HttpOnly`, `SameSite=Lax`, `Path=/` and no `Domain` in both. Different **names** per mode,
so a development cookie can never be mistaken for a production one, and no runtime flag can
weaken a production cookie.

CSRF is a signed double-submit pair: an HttpOnly cookie plus a server-rendered hidden field.
Before login the token is bound to nothing; after login it is bound to a fingerprint of the
raw session token, domain-separated so it is not the value NestJS uses as its database key.
A pre-login token replayed after authentication fails, and the reverse fails too.

Origin validation is strict on every state-changing handler: present, parseable, and an
exact match against `WEB_ALLOWED_ORIGINS`. **There is no `Referer` fallback** — `Referer` is
stripped by privacy settings far more often than `Origin` is, so a fallback becomes the path
everyone takes and the strict check stops meaning anything.

`apps/web/src/proxy.ts` does exactly one thing: issue the pre-login CSRF cookie for
`GET /login`. It cannot call NestJS, authenticate, authorize or reset a session, and tests
assert each prohibition.

**No handler mutates an authentication cookie on GET.** `SameSite=Lax` sends cookies on a
cross-site top-level GET navigation, so a cookie-clearing GET would let any page on the
internet sign a staff member out. Session reset is therefore a POST reached from a form on
`/session-expired`; its GET returns 405 with `Allow: POST`.

### Roles and permissions

| Permission            | Manager | Receptionist |
| --------------------- | :-----: | :----------: |
| `user.read`           |   yes   |      —       |
| `user.create`         |   yes   |      —       |
| `user.update_role`    |   yes   |      —       |
| `user.update_status`  |   yes   |      —       |
| `user.reset_password` |   yes   |      —       |
| `user.unlock`         |   yes   |      —       |
| `session.revoke_any`  |   yes   |      —       |

A receptionist holds **no** permission in Milestone 1 — deliberate, not an oversight. Their
access is the self-service endpoints, which need authentication but no permission. That stays
true through Milestone 2; Milestone 3 grants them the eight family and child permissions and
nothing else (see [Families and children](#families-and-children-milestone-3)).

Permission _names_ live in `@clinic/contracts` so the web tier can decide what to render.
The authoritative role-to-permission map lives in `apps/api` and nowhere else.

Four access classifications, one per route, deny-by-default: `PublicEndpoint` (`/health`
and `/health/ready` only), `InternalOnly` (internal key, no session — `/health/db` and `/auth/login`),
`AuthenticatedOnly`, and `RequirePermissions`. A route carrying none is rejected by the
first guard **and** fails a coverage test.

### Audit

`audit_log` is append-only, enforced by PostgreSQL: `BEFORE UPDATE`, `BEFORE DELETE` and
`BEFORE TRUNCATE` triggers raising SQLSTATE `23001`. The `TRUNCATE` trigger is not optional
— `TRUNCATE` bypasses row-level triggers entirely. `app_user` carries the same delete and
truncate protection, because user rows are permanent historical records.

`AuditService.record(tx, context, entry)` takes a transaction client as its first required
argument, so "the audit row commits with the state change" is a type error to get wrong, and
a runtime check rejects the base client. Payloads are hand-built; there is no automatic
diffing, which would capture password hashes and bury real changes under `last_seen_at`
churn. A payload guard throws on secret-looking keys and on any `$argon2` string, and a
database `CHECK` catches anything that gets past it.

**The durability boundary:** an unauthenticated request that does not cause a state
transition on an existing active account writes nothing to `audit_log`. Unknown usernames,
malformed identifiers, already-locked and disabled accounts, and forged session cookies go
to a rotatable operational security log instead — otherwise an attacker could grow an
unprunable table without bound. Successful logins and account-bound failure and lockout
transitions **are** audited transactionally.

One foreign key exists on `audit_log`: `actor_user_id`. `session_id` deliberately has none,
so expired sessions stay purgeable while the audit reference survives.

### Password policy

Length is measured in **Unicode code points of the NFC-normalised string** (NIST
SP 800-63B) — not UTF-16 units, not grapheme clusters: minimum 15, maximum 128, with
ill-formed input rejected first. No composition rules, no periodic expiry. Paste, autofill
and password managers are permitted, and a boundary check fails the build if anything blocks
them.

Argon2id at `m = 19456 KiB, t = 2, p = 1` behind a four-way concurrency semaphore. Every
login attempt performs **exactly one** verification — an unknown username is checked against
a dummy hash built at startup — and the outcome is computed only afterwards, so a locked or
disabled account costs the same as any other. Five failures inside a 15-minute window lock an
account for 15 minutes.

Persian and Arabic yeh and kaf are **never** folded together: they are different letters and
must remain different passwords. Persian (U+06F0–U+06F9) and Arabic-Indic (U+0660–U+0669)
digits _are_ folded to ASCII, but **only inside weak-pattern detection** — never for hashing,
storage, verification, NFC or general comparison. That is what lets one rule recognise
`۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵`, `١٢٣٤٥٦٧٨٩٠١٢٣٤٥` and `123456789012345` as the same weak shape, including
when they are mixed.

Keyboard-walk detection covers the standard Iranian layout (ISIRI 9147), **per row only**.
Rows are never joined: a slice spanning two rows is not something anyone can type, and
treating it as a walk would invent key adjacency. Slices of the Persian home row are real
words — `سیب` (apple) is three consecutive keys — which is why matching is whole-password and
never substring. Legacy, mobile and vendor-variant layouts are out of scope and not claimed.

The common-password list is the ≥15-character residue of a pinned public corpus:

```text
upstream   https://github.com/danielmiessler/SecLists
path       Passwords/Common-Credentials/xato-net-10-million-passwords-1000000.txt
tag        2026.1
commit     190c6f7bd58c847ceadfe57d9853592737f059e8
licence    MIT (Copyright (c) 2018 Daniel Miessler)
retrieved  2026-08-04
entries    10,898
```

The plan originally named `10-million-password-list-top-1000000.txt`; that path does not
exist at this tag, because upstream renamed the file to credit its actual source. The
committed file carries the full provenance header, the source checksum and the exact
reproducible filter command, and is refreshed only by a reviewed pull request. It is never
fetched at build or run time, and there is no online breached-password lookup.

## Clinic reference data (Milestone 2)

Therapists, services, rooms and effective-dated tariffs — the data every later milestone
prices and schedules against. All of it is **manager-only**; a receptionist holds no catalog
permission and receives `403` on every route and page.

### Scope, and what is deliberately absent

Built: services with allowed durations, rooms with optional service restrictions, therapists
with supported services, and tariffs with `PAID`/`FREE` pricing, effective dating, overlap
prevention, resolution and void-and-replace correction.

Not built, and each for a stated reason:

| Absent                                                     | Why                                                                                                                                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Availability** (recurring windows, dated exceptions)     | Nothing consumes it until appointment booking exists. Deferred to Milestone 4, where real conflict rules will shape it.                                                                                            |
| **Therapist login**                                        | Therapist access is a separately approved decision that has not been made (PROJECT_SPEC.md 4). A therapist here is a record staff manage; there is no username, password or session, and no relation to `AppUser`. |
| **Therapist settlement percentage**                        | Effective-dated and snapshotted per session (Milestone 8). A plain column now would be the wrong shape and would invite writing one.                                                                               |
| **Family-specific tariffs**                                | Families arrive in Milestone 3. The column is additive when they do.                                                                                                                                               |
| **Receptionist catalog access**                            | No receptionist workflow reads this data yet. Milestone 4 grants the specific `.read` permissions the booking screen actually needs — a one-line change to `ROLE_PERMISSIONS`.                                     |
| Duplicate-warning workflows, near-duplicate name detection | Approved for families (Milestone 3), not for catalog entities.                                                                                                                                                     |

Real clinic data — actual service names, room names, therapists, prices — is owner-provided
(PROJECT_SPEC.md 15, 17). Nothing is seeded, and no realistic-looking clinic data appears in
code, fixtures or tests.

### Services

Name, public description, allowed durations, and an active/inactive status. `isPublic` is
recorded now and read by nothing until the public-site milestone.

A duration that any tariff has ever priced **cannot be withdrawn** — including one priced by a
voided tariff, because a voided tariff is history and history keeps its references. The
`tariff_service_id_duration_minutes_fkey` foreign key is `ON DELETE RESTRICT`, and the attempt
surfaces as `SERVICE_DURATION_IN_USE` rather than a raw constraint error. Deactivate the
service instead.

### Rooms

Name, status, and an allow-list of services. **An empty list means unrestricted** — the
common case. That asymmetry is why the form asks the question outright ("قابل استفاده برای
همهٔ خدمات" versus "محدود به خدمات انتخاب‌شده") rather than letting an untouched multi-select
mean "any service": the two are identical in the data, so the interface has to be what
distinguishes them.

A restriction naming a service that is later deactivated is **kept**. It is configuration
somebody entered, and reactivating the service must not require restoring a decision nobody
reversed.

### Therapists

Full name, specialty, status, and supported services. Names are **not unique**: two real
people may share a name and a specialty, and refusing the second would be refusing a person.

Supported services behave like room restrictions — replaced atomically with the therapist
update and its audit row, and never silently dropped when a service is deactivated. The edit
form keeps an inactive service listed, checked, and marked «خدمت غیرفعال».

### Tariffs

A price for one `(service, duration)`, either for a specific therapist or general
(`therapistId = NULL`), over an inclusive effective date range.

**Resolution** takes a service date and returns the applicable price. A therapist-specific
tariff wins over a general one for the same date; a miss is `TARIFF_MISSING`, a visible error
rather than a silent zero (PROJECT_SPEC.md 5). The service date is always the caller's — never
today — so a session in Mordad is priced by the tariff in force in Mordad, even if the service
or therapist has since been deactivated.

**Overlap** is prevented by two partial `EXCLUDE` constraints, not by reading before writing.
Two live general tariffs may not overlap for the same service and duration; two live
therapist-specific ones may not overlap for the same service, duration and therapist. A
general and a therapist-specific tariff may cover the same range — that is what makes
precedence possible. Concurrent overlapping inserts produce exactly one success and one
`TARIFF_OVERLAP`.

**Immutability.** A tariff is written once. The `tariff_enforce_immutability` trigger permits
exactly one transition — active to voided — and refuses every other change, including
unvoiding and rewriting a void reason. There is no update endpoint and no delete endpoint. A
correction voids the row and inserts a replacement in one transaction, producing two
independently inspectable audit rows (`tariff.voided`, then `tariff.created`). A replacement
must price the same service, duration and therapist scope; changing what is priced is a new
tariff, not a correction (`TARIFF_SCOPE_MISMATCH`). The price _mode_ may legitimately change
between `PAID` and `FREE` — that corrects what the price is, not what is priced.

### Paid and intentionally free

`priceMode` is explicit and is **never inferred from a zero amount**.

- `PAID` — a real price above zero, at most 1,000,000,000 toman (a fat-finger guard, not a
  modelled ceiling), and no free reason.
- `FREE` — exactly zero, a stated `freeReason`, and a request-only `confirmFreePrice: true`.

The clinic runs genuinely free programmes — complimentary screening, introductory
consultations — and that is a different fact from an ordinarily paid service discounted to
nothing for one family. The first is a `FREE` tariff; the second stays `PAID` and belongs to
the later discount model, which preserves the original price.

The confirmation is a deliberate speed bump: creating a free programme has to be something
somebody chose, not something they reached by leaving a field blank. It is **never persisted
and never audited** — there is no such column, and it appears in no audit payload.

**A `FREE` tariff says what the family pays and nothing else.** Whether the therapist is
compensated for a complimentary session, and whether the clinic absorbs the cost, is an
independent settlement decision (Milestone 8) and must not be inferred from this value.

### Dates, money and the clinic timezone

| Concern         | At rest                                           | Over the API                | In the interface                                   |
| --------------- | ------------------------------------------------- | --------------------------- | -------------------------------------------------- |
| Effective dates | PostgreSQL `DATE` (Gregorian, no time, no offset) | strict `YYYY-MM-DD` strings | Jalali, via server-rendered year/month/day selects |
| Money           | `BIGINT`, integer toman                           | decimal strings             | Persian digits, `٬` grouping, `تومان`              |

A date never crosses as a JavaScript timestamp, and money never crosses as a number — JSON has
no integer type, and a value above 2^53 would lose precision silently. `apps/api/src/common/
iso-date.ts` converts through UTC components only; local getters would shift the calendar day
either side of midnight depending on where the process runs.

The Jalali control is **not** `<input type="date">`: that widget is Gregorian in every browser,
and labelling it as Jalali would show one calendar while submitting another. Conversion happens
in the Route Handler, before the shared contract sees anything.

**The clinic business timezone is `Asia/Tehran`**, a constant in
`apps/web/src/server/clinic-time.ts`. It is used only to classify a tariff for display as
current, future or expired — never to resolve a price. Tehran is UTC+03:30 with no DST, so its
date rolls over at 20:30 UTC; using UTC or the server's local zone would mislabel a tariff for
three and a half hours of every day.

### Permissions

Fifteen catalog permissions, all held by `MANAGER` and none by `RECEPTIONIST`:

`therapist.read|create|update|update_status`, `service.read|create|update|update_status`,
`room.read|create|update|update_status`, `tariff.read|create|void`.

Voiding is separate from creating: correcting a price already in force is a different
authority from setting one, and later milestones may grant them differently.

### Endpoints

```text
GET    /catalog/services            GET    /catalog/rooms
GET    /catalog/services/:id        GET    /catalog/rooms/:id
POST   /catalog/services            POST   /catalog/rooms
PATCH  /catalog/services/:id        PATCH  /catalog/rooms/:id
PATCH  /catalog/services/:id/status PATCH  /catalog/rooms/:id/status

GET    /catalog/therapists          GET    /catalog/tariffs
GET    /catalog/therapists/:id      GET    /catalog/tariff-resolution
POST   /catalog/therapists          GET    /catalog/tariffs/:id
PATCH  /catalog/therapists/:id      POST   /catalog/tariffs
PATCH  /catalog/therapists/:id/status POST /catalog/tariffs/:id/void
```

No delete route exists on any of them. `/catalog/tariff-resolution` is deliberately not nested
under `/catalog/tariffs/`, where it would share a space with `/catalog/tariffs/:id` and depend
on route declaration order.

### Persian pages

`/services`, `/rooms`, `/therapists`, `/tariffs` — plus `new` and `[id]/edit` for the first
three, and `/tariffs/new?supersedes=<id>` for a tariff correction. There is no tariff edit page,
because there is no such thing as editing a tariff.

Server Components throughout, **zero client JavaScript on these pages**, ordinary form posts
to one Route Handler per state change, and redirect-with-error-code for failures. Tailwind
CSS v4 provides the utilities; there is no component toolkit and no client runtime. Milestone
3 adds the product's single allow-listed Client Component, on the family search screen only.

### Database objects

Seven tables — `therapist`, `service`, `service_duration`, `room`, `therapist_service`,
`room_service`, `tariff` — with two enums (`catalog_status`, `tariff_price_mode`).

The reviewed migration hand-writes what Prisma cannot express: 17 CHECK and EXCLUDE
constraints, 8 no-delete/no-truncate triggers, and the tariff immutability trigger. Every one
is pinned by name in `catalog-schema.int-spec.ts`, because `prisma migrate diff` does not see
CHECK constraints or triggers and would let one disappear silently.

`created_by_user_id` is `NOT NULL` on all four entity tables: there is no anonymous or system
path that creates clinic reference data.

The overlap constraints need the **`btree_gist`** extension, which the migration creates. It
requires extension-creation privilege — available in the dev and CI containers, and worth
confirming on any managed host before the pilot.

## Families and children (Milestone 3)

The first receptionist workflow, and the first personal data in the product: families with
their guardians, and the children who attend sessions. A family may have many children; the
balance that arrives in a later milestone belongs to the family, and every charge will name
the child (PROJECT_SPEC.md 5, 7).

This is also the first milestone a **receptionist** can use. They hold exactly the eight
family and child permissions and nothing else — no catalog, no tariffs, no user or session
administration.

### Scope, and what is deliberately absent

Built: family registration with one to six guardians, child registration, search across
family name, guardian name, child name, phone number and file number, duplicate detection
with an explicit acknowledgement step, editing, and active/inactive status for both records.

Not built, and each for a stated reason:

| Absent                                          | Why                                                                                                                                                                                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Moving a child between families**             | It rewrites who owes for every session that child has ever had. A genuine reassignment is a designed, audited repair belonging to the milestone that owns financial history; until then PostgreSQL refuses it outright. |
| **Deleting a family or child**                  | Final records are voided or adjusted, never physically deleted (CLAUDE.md). Deactivation is the operation; no-delete triggers enforce the rest.                                                                         |
| **Merging two families found to be duplicates** | Merging moves children and, later, money. Same reason as reassignment: it belongs with financial history.                                                                                                               |
| **Family-specific tariffs, ledgers, balances**  | Milestones 5 onward. Nothing here calculates money.                                                                                                                                                                     |
| **Clinical records, diagnoses, therapy notes**  | Out of product scope entirely (CLAUDE.md, Product boundary).                                                                                                                                                            |

No real clinic data appears anywhere. Every fixture, test and example name is synthetic
(PROJECT_SPEC.md 17).

### Families and guardians

A family is a name, an optional address and note, a status, and one to six guardians.
Exactly one guardian is the primary contact, enforced by a partial unique index rather than
by application code. Guardians are current configuration, not history: an edit replaces the
set wholesale and `audit_log` records them as values, exactly as Milestone 2 does for
`therapist_service`.

Mobile and landline numbers are validated as Iranian numbers by the contract. A national
identifier (کد ملی) is optional everywhere it appears — requiring one would refuse a newborn
who does not have one yet, and slow the phone-call path this milestone exists to protect —
but when present its check digit is verified in the contract and its ten-digit shape is
pinned by a `CHECK`.

### Children

First and last name, birth date, sex, optional national identifier, optional legacy paper
file number, referral source, note and status.

`file_number` is **generated**, never accepted from a request: it is
`lpad(nextval('child_file_number_seq'), 5, '0')`, so nobody types it and nobody collides on
it. It is quoted aloud, printed and written on a paper file, so a number that could change
would not be an identifier — `child_enforce_identity_immutability` refuses any update to it,
and to `id`, `family_id`, `created_at` and `created_by_user_id`, with the same SQLSTATE
`23001` every other "the database refuses to rewrite this" failure raises.

### Search

`POST /families/search`, not `GET`. The term is a guardian's name, a child's name, a mobile
number or a file number — personal data, which must not reach a URL, browser history, a
`Referer` header or an access log.

Matching runs over normalised copies of the searchable columns (`fa_normalize`, which folds
Arabic/Persian letter variants, Persian and Arabic-Indic digits, and diacritics), so a name
typed with a Farsi ی finds one stored with an Arabic ي. A digit query matches a phone number
by suffix once it reaches four digits — shorter than that it returns most of the clinic — and
matches a file number exactly. An empty query returns the 25 most recent registrations, which
is the "I just registered them" path. Results cap at 50 with a `truncated` flag rather than
paging.

### Duplicate detection

Five rules, of which two **block** a write until a member of staff explicitly acknowledges
the candidate, and three are informational and never refuse anything:

| Rule                               | Kind          | Fires when                                                    |
| ---------------------------------- | ------------- | ------------------------------------------------------------- |
| `FAMILY_DUPLICATE_MOBILE`          | blocking      | An active family already holds one of the submitted mobiles.  |
| `CHILD_DUPLICATE_IN_FAMILY`        | blocking      | Same normalised name and identical birth date, in one family. |
| `SIMILAR_FAMILY_NAME_AND_GUARDIAN` | informational | Matching family name and a matching guardian name.            |
| `SIMILAR_CHILD_IN_OTHER_FAMILY`    | informational | Same name and birth date, in a different family.              |
| `SHARED_LANDLINE`                  | informational | Another family lists the same landline.                       |

Similarity alone is never a refusal. Two real families sharing a surname is ordinary, and
blocking them is the exact failure this milestone is built to avoid; the informational rules
return a `NoticeCode` alongside a write that succeeded.

**Blocking rules are recomputed under a lock, not merely read.** A check that reads before it
writes is not a check under concurrency: two receptionists registering the same family at the
same moment both read "no duplicate" and both insert. Every blocking rule is therefore
recomputed while a transaction-scoped advisory lock is held on the value being compared, with
one global lock order — `registration_draft` → `family` → `child` → advisory keys, and
ascending numeric key order within a class — so no two transactions can deadlock. Keys come
from PostgreSQL's own `hashtextextended`; a second implementation in Node would have to agree
bit for bit forever, and the day it stopped agreeing the mechanism would fail open.

The candidates offered back carry a family name, who answers the phone and the **last four
digits** of the number — enough to recognise a family, not a copy of an identifier in an
error body that staff may never read.

### Registration drafts

A duplicate is only detectable after a submission, and a Route Handler cannot render a page,
so something has to hold what was typed across the confirmation step. That something is a
`registration_draft` row, not a cookie: a signed cookie gives integrity, not confidentiality,
and a family with an address, a note and several guardians can exceed practical cookie size
limits — failing intermittently, and only for the largest records.

A draft is transient workflow state, not a domain record. It is never audited (auditing one
would create a permanent record of a submission that was never made), it carries no
no-delete or no-truncate trigger because deletion is how it ends, and neither its payload nor
its token is ever logged. It expires after ten minutes, measured by PostgreSQL.

Missing, expired, already consumed, wrong user, wrong session and wrong purpose all answer
`DRAFT_NOT_FOUND`. A draft token is a bearer credential, and distinguishing those conditions
would tell its holder which one they tripped — the same reasoning behind
`AUTH_INVALID_CREDENTIALS`.

The token reaches the browser exactly once, in the body of the `409`, and the web tier puts
it straight into an **HttpOnly cookie**. It never appears in a form field, in the
confirmation page's markup, or in a redirect target.

### Audit and personal data

`audit_log` is append-only and permanent, so anything copied into it is a second, unbounded,
undeletable store of that value. National identifiers and phone numbers are therefore reduced
to their last four digits — enough to confirm a row refers to the number in front of you, not
enough to be a copy of it. Names, notes and addresses are written in full: a change to a name
_is_ the fact being recorded.

Three layers enforce it. `audit-safe.ts` is the only place a family or child payload is
built; `assertAuditPayloadSafe` walks every payload and throws on an identifier that is
neither `null` nor exactly masked; and `audit_log_masked_identifiers_chk` makes PostgreSQL
refuse the row. The masked shapes are exact rather than prefixed — six asterisks and four
digits is unsatisfiable by a ten-digit value — so a full identifier cannot masquerade as a
masked one.

### Permissions

Eight permissions, held by both roles:

`family.read|create|update|update_status`, `child.read|create|update|update_status`.

A receptionist held no permission at all through Milestones 1 and 2. From here they hold
exactly these and nothing else, and `permissions.spec.ts` asserts both halves — what they
have, and what they still do not.

### Endpoints

```text
POST   /families/search              POST   /families/:familyId/children
GET    /families/:id                 GET    /children/:id
POST   /families                     PATCH  /children/:id
PATCH  /families/:id                 PATCH  /children/:id/status
PATCH  /families/:id/status          POST   /children/confirm-registration
POST   /families/confirm-registration POST  /children/confirm-update
POST   /families/confirm-update

GET    /registration-drafts/current
POST   /registration-drafts/discard
```

Search is a `POST` because its body is personal data. There is no delete route on anything,
and no route that changes a child's `familyId`. Each confirmation route lives on the
controller that owns the write it completes and supplies its own `DraftPurpose`, so a token
minted for one flow can never be spent on another.

### Persian pages

`/families`, `/families/new`, `/families/confirm`, `/families/[id]`, `/families/[id]/edit`,
`/families/[id]/children/new`, `/children/[id]/edit`.

Every one is `force-dynamic` and `noindex`, and every one carries `Cache-Control: no-store`
from `next.config.ts` — a cached family page on a shared reception machine is readable by
whoever sits down next. `Referrer-Policy` is `same-origin` rather than `no-referrer` on these
pages; see the decision log entry of 2026-08-09 for why `no-referrer` silently breaks every
form on them.

These pages hold the product's **one Client Component**,
`app/families/family-search.tsx`, whose entire job is to own `useActionState`. Family search
is a Server Action rather than a Route Handler precisely so the term never needs a URL, a
redirect or a cookie to survive — and reading an action's return value requires a client
hook. It is named in `CLIENT_COMPONENT_ALLOWLIST` in `scripts/check-web-boundary.mjs`, so a
second one is a visible diff in review rather than a quiet drift back towards a
client-rendered application. Everything else remains a Server Component.

`handler-coverage.test.ts` enumerates every `'use server'` module and fails the build for one
that does not resolve a session and name a permission — a Server Action is a
browser-reachable endpoint that no Route Handler guard covers.

### Database objects

Four tables — `family`, `guardian`, `child`, `registration_draft` — with four enums
(`record_status`, `guardian_relationship`, `child_sex`, `draft_purpose`).

The reviewed migration hand-writes 26 CHECK constraints, three partial unique indexes
(`guardian_one_primary_per_family_uq`, `child_national_id_uq`,
`child_legacy_paper_file_number_uq`), four no-delete/no-truncate triggers on `family` and
`child`, the child identity immutability trigger, and four functions: `fa_normalize`,
`search_like_escape`, `clinic_date` and `audit_identifiers_masked`. Every one is pinned by
name in `families-schema.int-spec.ts`, because `prisma migrate diff` does not see CHECK
constraints or triggers and would let one disappear silently.

`guardian` and `registration_draft` deliberately carry no delete trigger, for different
reasons: guardians are configuration replaced wholesale and recorded as audit values, and a
draft is meant to be consumed and removed.

A table owner can still `ALTER TABLE ... DISABLE TRIGGER`. Since Milestone 10 the API
is not the owner and cannot — see [Database roles](#database-roles).

## Appointments (Milestone 4)

The clinic diary. Therapist working hours, one-time and weekly-recurring bookings,
conflict protection, the day view a receptionist keeps open, and the recorded
outcome of every session.

This is the first milestone with **daily traffic**, and the first where a
receptionist holds an operational authority beyond family records: they run the
diary end to end, including the one authorised override, and hold no permission
to reverse a completion.

### Scope, and what is deliberately absent

Built: recurring weekly availability with dated exceptions, one-time booking,
weekly recurrence with preview and all-or-nothing creation, therapist/room/child
conflict protection, move, cancellation by family or clinic, completion,
per-participant attendance, manager-only reopen, the daily operational review, and
a read-only tariff suggestion.

Not built, and each for a stated reason:

| Absent                                       | Why                                                                                                                                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Price snapshot on the appointment**        | The snapshot exists so a session is charged the price of the day it happened, and booking is not that day. It arrives in Milestone 5 with the charge (decision log, 2026-08-13). |
| **Any charge, payment, balance or discount** | Milestone 5 onward. Nothing here reads a tariff except one read-only screen query, and nothing here writes an amount.                                                            |
| **`RESCHEDULED` and `VOIDED` statuses**      | A move is an audited in-place update of the same row, and there is no financial record yet to void (decision log, 2026-08-13).                                                   |
| **Group bookings**                           | The two-level structure is built and an individual appointment has exactly one participant. Multi-participant booking needs approved group billing rules.                        |
| **Multi-weekday or monthly recurrence**      | One weekday per series. A child seen twice a week is two series, which keeps "this and all future occurrences" a question with one answer.                                       |
| **Extending a series**                       | Not an approved operation. Shortening one is `cancel-from`; a longer arrangement is a new series.                                                                                |
| **Deleting an appointment**                  | A cancelled session stays visible in its day and in every report of it (PROJECT_SPEC.md 14). No-delete triggers enforce it.                                                      |
| **Therapist self-service scheduling**        | Therapist login is separately approved and has not been (PROJECT_SPEC.md 4).                                                                                                     |

No real clinic data appears anywhere. Every fixture, test and example is
synthetic (PROJECT_SPEC.md 17).

### Two facts: the booking, and the seat

`appointment` is the shared resource booking — one therapist, one room, one
service, one time range — and its `status` is one of four: `SCHEDULED`,
`COMPLETED`, `CANCELLED_BY_FAMILY`, `CANCELLED_BY_CLINIC`.
`appointment_participant` is a child's seat in it, and its `attendance` is
`PENDING`, `ATTENDED` or `NO_SHOW`.

**A no-show is a seat's outcome, not a booking's status.** The room was held and
the therapist waited. Neither fact is derived from the other: completing a session
does not resolve an outcome, and recording an outcome does not complete a session.
Milestone 5's rule — only an attended participant in a completed appointment may
be charged — needs both.

`SCHEDULED` and `COMPLETED` occupy the therapist, the room and the child; both
cancellations release all three, which is what makes a cancelled slot re-bookable.

### Time, dates and the week

`starts_at` and `ends_at` are `timestamptz`, and every calendar question about
them is answered by PostgreSQL — `clinic_date`, `clinic_clock_time`,
`clinic_day_start`, `clinic_moment` — so `Asia/Tehran` stays written once.

The week is **Saturday-first**: weekday 0 is Saturday and 6 is Friday, in the
contract, the database and every screen. PostgreSQL's `EXTRACT(DOW)` is
Sunday-first and is translated at the boundary; the native numbering is never
stored or returned.

A start carrying seconds is refused, and so is a session whose clinic start and
end days differ — the latter before the availability override is even considered,
because an overnight session is not a shape the model can express.

### Availability

Recurring weekly windows plus dated exceptions, and **no effective dating**: a
window applies whenever it is asked about, the set is replaced wholesale, and the
set that was replaced is preserved in `audit_log` as values.

One precedence rule, stated in exactly one place: a **closed-day** exception
suspends the recurring week for that date and leaves any **extra window** dated to
it standing. "Not my usual Saturday, but I will come in for 15:00–18:00" is the
arrangement that needs both.

Removing a dated exception is the only `DELETE` in the application, and it is
audited before the row goes.

### Conflicts, and the one override

| Rule                    | Mechanism                                                                     | Overridable                     |
| ----------------------- | ----------------------------------------------------------------------------- | ------------------------------- |
| Therapist overlap       | `appointment_no_therapist_overlap_excl` — partial GiST exclusion, `[)` bounds | **No**                          |
| Room overlap            | `appointment_no_room_overlap_excl` — partial GiST exclusion, `[)` bounds      | **No**                          |
| Child overlap           | SQL recomputation under a transaction-scoped advisory lock on the child       | **No**                          |
| Outside therapist hours | `AvailabilityService.resolve` inside the booking transaction                  | Yes, with permission and reason |

The two exclusion constraints mean nothing reads before writing: two simultaneous
bookings for one room cannot both pass, whatever an application check saw first,
and the constraint that fired decides which resource the receptionist is told is
busy. Back-to-back sessions do not clash — `[)` bounds are the normal shape of a
clinic day.

The child's overlap cannot be a constraint (the child is on one table and the time
on another), so it is recomputed in SQL while an advisory lock is held on that
child — the mechanism the Milestone 3 duplicate rules use, for the same reason.

Booking outside a therapist's hours requires `appointment.override_availability`
**and** a stated reason, and is recorded twice over: on the appointment row for
operational visibility, and in the audit row's `metadata` with the hours it fell
outside, as values. Nothing else may be overridden.

Hard failures with no override at all: an inactive service, therapist, room, child
or family; a therapist who does not provide the service; a room not allowed to
host it; a duration the service does not offer; an invalid or overnight time.

### Recurrence

A series is a first booking plus a weekly rule: one weekday, one time of day,
every week or every n-th week, bounded by an occurrence count or a last date. The
first occurrence _is_ the pattern.

Two bounds, and a series must satisfy both: **at most 52 occurrences**, and **no
occurrence more than 12 months** after the first. Breaking either is
`RECURRENCE_RULE_INVALID` — never a silently truncated series.

**Preview writes nothing** and reports, per occurrence, whether it is outside the
therapist's hours and what would block it. It is advisory: the create re-decides
everything under its own locks. **Creation is all or nothing** — twelve
occurrences or none.

Every occurrence is an ordinary appointment with its own id, status, audit history
and seat. Moving or cancelling one week is the ordinary single-appointment
lifecycle; `cancel-from` and `update-from` act on the still-`SCHEDULED`
occurrences from a named pivot onwards, leaving completed and already-cancelled
weeks exactly as they are.

### Tariff suggestion

The day view and the appointment view resolve the current tariff live, against the
appointment's own clinic date, therapist, service and duration, through the same
SQL `/catalog/tariff-resolution` uses. It is **read-only, stored nowhere, and
non-blocking**: a service with no tariff shows `MISSING` rather than failing the
screen (PROJECT_SPEC.md 5).

The class that reads it holds no transaction and writes no row; the class that
books, moves, completes and cancels never looks at a tariff.

### Permissions

Eleven new grants for the receptionist: `therapist.read`, `service.read`,
`room.read`, `tariff.read`, `availability.read`, and
`appointment.read|create|update|cancel|complete|override_availability`.

Manager-only: `appointment.reopen` and `availability.manage`, plus every catalog
write as before. `permissions.spec.ts` asserts both halves.

### Endpoints

```text
GET    /availability/therapists/:therapistId/windows
PUT    /availability/therapists/:therapistId/windows
GET    /availability/therapists/:therapistId/exceptions
POST   /availability/therapists/:therapistId/exceptions
DELETE /availability/therapists/:therapistId/exceptions/:id
GET    /availability/resolution

POST   /appointments                     GET  /appointment-day
GET    /appointments/:id                 POST /appointment-series/preview
GET    /appointments/:id/view            POST /appointment-series
PATCH  /appointments/:id                 GET  /appointment-series/:id
POST   /appointments/:id/cancel          POST /appointment-series/:id/cancel-from
POST   /appointments/:id/complete        PATCH /appointment-series/:id/update-from
POST   /appointments/:id/reopen
PUT    /appointments/:id/participants/:participantId/attendance
```

`/appointment-day`, `/appointment-series` and `/availability/resolution` are paths
of their own rather than `/appointments/day` and the like: a literal segment
beside `:id` makes which route answers depend on declaration order.

`GET /appointments/:id` returns the plain booking and its seats — the shape every
write returns and what a caller re-reads to confirm a transition. `GET
/appointments/:id/view` is the screen-ready reading, with names and the price
suggestion. They are separate because a write must not carry a price, and a screen
must.

### Persian pages

`/availability`, `/therapists/[id]/availability`, `/appointments`,
`/appointments/new`, `/appointments/[id]`, `/appointments/[id]/edit`,
`/appointment-series/[id]`.

Every one is `force-dynamic` and `noindex`. The appointment and series pages carry
`Cache-Control: no-store` and `Referrer-Policy: same-origin` from
`next.config.ts`, for the reason the family pages do — a cached page on a shared
reception machine is readable by whoever sits down next.

The booking screen's **child search is a Server Action**, exactly as family search
is: the term is a child's or a guardian's name, and it must never reach a URL, a
redirect or a cookie. `app/appointments/new/booking-workflow.tsx` is the third and
final entry in `CLIENT_COMPONENT_ALLOWLIST`, alongside the weekly-availability
editor, which owns only local row state before its one wholesale `PUT`.

Every state-changing page action posts to a named Route Handler under `/api`,
which verifies strict Origin and the CSRF token before calling NestJS.
`handler-coverage.test.ts` enumerates all of them and fails the build for one that
does not.

### Database objects

Five tables — `appointment`, `appointment_participant`, `appointment_series`,
`therapist_availability`, `therapist_availability_exception` — with three enums
(`appointment_status`, `attendance_outcome`, `recurrence_end`) and a `timerange`
range type.

The five reviewed migrations hand-write the two GiST exclusion constraints on
`appointment`, one on `therapist_availability` and one on
`therapist_availability_exception`; a partial unique index for one closure per
date; the CHECK constraints that keep `ends_at`, the completion and cancellation
timestamps, the attendance timestamp, the override triple and the series bounds
internally consistent; no-delete and no-truncate triggers on the three appointment
tables; identity-immutability triggers on `appointment` and
`appointment_participant`; and three functions — `clinic_clock_time`,
`clinic_day_start` and `clinic_moment` — beside Milestone 2's `clinic_date`.

Every object is pinned by name in `appointments-schema.int-spec.ts` and
`availability.int-spec.ts`, because `prisma migrate diff` sees neither CHECK
constraints nor triggers and would let one disappear silently.

The two availability tables deliberately carry **no** delete trigger: they are
current configuration recorded in `audit_log` as values, like `guardian` and
`therapist_service`.

A table owner can still `ALTER TABLE ... DISABLE TRIGGER`. Since Milestone 10 the API
is not the owner and cannot — see [Database roles](#database-roles).

## Family ledger (Milestone 5)

The first money in this system. A completed session that a child actually attended
becomes a **session charge** carrying the price of the day it happened; a manager may
reduce one with a clinic-funded discount or waiver, or withdraw one entirely; and a
family account states what the family was charged, per child, derived on every request.

This is the milestone where a record stops being correctable by editing it. Nothing
financial is deleted and nothing is rewritten: a mistake is voided and re-posted, and
both rows survive.

### Scope, and what is deliberately absent

Built: the exactly-once primary session charge with its service-date tariff snapshot,
posted by whichever of completion and attendance is recorded last; the explicit,
idempotent re-post; manager-only charge void; manager-only clinic-funded adjustments and
their void; charge-level lifecycle guards that refuse a reopen or an attendance reversal
while the money still stands; the participant charge read an appointment screen needs;
and the family account with derived totals.

Not built, and each for a stated reason:

| Absent                                                      | Why                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Payments, credits, allocation, promises, balance**        | Milestone 6. Nothing here has been paid, so `netChargedTotalToman` says what was asked for and is deliberately not named or shaped like a balance.                                                                                                                                                                                                                                                                               |
| **Shared or therapist-funded discounts**                    | Therapist settlement — effective-dated share percentages and their snapshot onto a session — was Milestone 8 and was not approved here. A therapist cannot be said to bear part of a concession until it is. **Delivered in Milestone 8 checkpoint C4**, on top of the applied share snapshot; the `therapist_discount_toman = 0` CHECK this milestone wrote was dropped there and replaced by a cumulative therapist-net floor. |
| **Therapist share, settlement period, negative clinic net** | Not computable without the above, and not claimed to be. No column on either table stores a percentage or a share — and none does after C4 either: the share lives on `session_settlement`, and a negative clinic net is derived by reading rather than stored. A settlement period remains unbuilt.                                                                                                                             |
| **Pre-Milestone-5 and paper debt, opening balances**        | The ledger begins with the first charge this system posts. Historical amounts owed on paper are not represented, and no total here should be read as a family's whole financial history.                                                                                                                                                                                                                                         |
| **An upward correction of a charge**                        | `charge_adjustment` only ever reduces. "The family owes more than the session was priced at" is a different fact with no approved rule.                                                                                                                                                                                                                                                                                          |
| **Editing or deleting a financial row**                     | Final records are voided or adjusted, never physically deleted (CLAUDE.md, PROJECT_SPEC.md 7). Both tables refuse `DELETE` and `TRUNCATE` outright.                                                                                                                                                                                                                                                                              |

No real clinic data appears anywhere. Every fixture, test and example is synthetic
(PROJECT_SPEC.md 17).

### The two facts, and the one routine that reads them

A primary charge may exist only when the appointment is `COMPLETED` **and** the seat's
attendance is `ATTENDED`. Those are recorded separately, in either order, and
`ChargePostingService.post` — the only runtime path that may create a charge — is called
by completion, by attendance and by the explicit re-post. Whichever fact lands second
raises the charge; a cancellation and a `NO_SHOW` create nothing because they cannot
satisfy the conjunction, not because a caller remembered a condition.

`session_charge_one_valid_per_participant_uq` is the final authority on "at most one
valid charge per seat", and it is partial on `voided_at IS NULL` — which is exactly what
makes void-then-re-post possible while both rows stay in the table.

A session nobody priced is **not** charged zero. Completion and attendance still succeed,
the session stands visibly unpriced, and the explicit re-post answers `TARIFF_MISSING`
until a tariff is recorded. A `FREE` tariff is a different fact and produces a real zero
charge with `priceMode = FREE`; `session_charge_price_mode_chk` keeps a genuinely free
session and a paid session waived to zero structurally unreachable from one another.

### Every Milestone 5 discount is clinic-funded

`therapist_discount_toman` is `0` and `clinic_discount_toman` equals the adjustment on
every row, written by the server and enforced by `charge_adjustment_clinic_borne_chk`.
The frozen request carries no therapist portion and no override, so a shared or
therapist-funded concession is **not representable** in this milestone and cannot be
disguised as a clinic-funded one. The split identity — therapist portion plus clinic
portion equals the family discount — is stated in its general form and stays when
Milestone 8 drops the restriction; no historical row is rewritten then, because every
Milestone 5 adjustment was and remains genuinely clinic-borne.

The cumulative bound is enforced under a lock on the parent charge, so a family's
effective amount for a session can never go below zero, and a `FREE` charge is
unadjustable for the same reason — there is nothing priced to reduce.

### Corrections, and what stays visible

Voiding writes three columns and touches nothing else. The snapshot, the actor, the
instant and the amount stay exactly as raised, and the void carries its own actor, time
and required reason. A voided charge contributes to no total and remains readable
forever, as does every adjustment attached to it. Voiding an adjustment restores what it
had removed, by the read rather than by a stored number, and preserves both reasons.

**A valid charge guards the lifecycle.** Reopening a completed appointment and reversing
an `ATTENDED` seat both falsify the premise the money rests on, so the ledger refuses
them with `CHARGE_EXISTS_FOR_PARTICIPANT` — naming the blocking charge and its effective
amount — and nothing is auto-voided. The approved sequence is: void the charge with a
financial reason, then correct the session with a lifecycle reason. If the session is
completed and attended again, the ordinary posting path raises a new charge and the
withdrawn one stays.

### Totals are derived, never stored

There is no balance column and no cache. Every number in the family account is computed
from the immutable rows on each request: a charge counts if it is not voided, and an
adjustment reduces only if neither it nor its parent charge is voided. The totals are one
aggregate over the whole filtered account, so **turning the page cannot change them**, and
`includeVoided` narrows the list alone — hiding history is a display choice, never a
financial one. The read runs in a `REPEATABLE READ` transaction so its four statements
describe one instant; it takes no locks and blocks no writer.

Group sessions are not collapsed: a row is one charge for one child, keyed by the seat,
so a family with two children in therapy sees each session attributed to the child who
was treated.

### Permissions

`charge.read` and `charge.post` are held by the **manager and the receptionist**: reading
a family account, and raising the charge for a session that happened — the ordinary end
of the diary work they already own, and idempotent, so holding it can never duplicate
money.

`charge.void` and `charge.adjust` are **manager-only**, for both granting and withdrawing
a concession (decision log, 2026-08-14). There is no same-day receptionist window and no
authority that expires. `permissions.spec.ts` and `guards.int-spec.ts` assert both halves
— the exact list the receptionist has, and the two they still do not.

### Endpoints

```text
POST /session-charges/participants/:participantId
GET  /session-charges/participants/:participantId
POST /session-charges/:id/void
POST /session-charges/:chargeId/adjustments
POST /session-charges/:chargeId/adjustments/:adjustmentId/void
GET  /families/:id/account
```

The post names the seat because a charge is not a document a caller composes — it is what
one seat costs — and the body is empty: every financial value is resolved by the server.
It answers 200 with `POSTED` or `ALREADY_POSTED`, never 201, because the outcome is what
an interface renders. The `GET` on the same URL answers with the charge that stands, or
the most recently withdrawn one if none does, so "charged and taken back" is
distinguishable from "never charged"; 404 means the seat has no charge history at all.

Adjustments are addressed under their charge and both operations answer with the whole
charge — its history and its two server-computed totals — so no screen has to work out
what the family now owes.

`GET /families/:id/account` lives on the family's path and requires `charge.read` rather
than `family.read`: reading who a family is and reading what they owe are two authorities.
Nothing on it is audited — `audit_log` is permanent, and copying a financial read into it
would build a second undeletable store of who was treated and for how much.

### Persian pages

`/families/[id]/account`, plus the charge surfaces on `/appointments` and
`/appointments/[id]`. All are `force-dynamic`, `noindex`, and carry `Cache-Control:
no-store` and `Referrer-Policy: same-origin` from `next.config.ts` under the already
private `/families` and `/appointments` trees.

Every one is a Server Component; Milestone 5 adds no entry to
`CLIENT_COMPONENT_ALLOWLIST`. No amount is computed in the browser: the pages format the
decimal strings NestJS states and nothing else. The four state-changing actions post to
named Route Handlers — `/api/ledger/session-charges/post|void` and
`/api/ledger/adjustments/create|void` — which verify strict Origin and the CSRF token
before calling NestJS.

The interface separates the facts that read alike: `رایگان از ابتدا` for a genuinely free
session and `تعرفهٔ مبلغ‌دار، تخفیف کامل` for a paid one waived to zero; voided rows are
marked and explained as history with no current effect; every correction form requires a
reason; and there is no therapist-allocation input anywhere, because there is nothing
approved for it to mean.

### Database objects

Two tables — `session_charge` and `charge_adjustment` — and no others. No payment,
credit, promise, balance or settlement table exists, and no financial column was added to
`appointment` or `appointment_participant`.

The reviewed migration hand-writes nine CHECK constraints, the partial unique index
`session_charge_one_valid_per_participant_uq`, nine triggers, and four functions:
`enforce_financial_row_born_active` (a charge inserted already voided would sidestep the
exactly-once index), `enforce_charge_adjustment_bounds` (the cumulative floor, which locks
the parent charge `FOR UPDATE` inside the insert), and the two financial immutability
triggers, which permit exactly one active-to-voided transition and refuse every other
update including unvoiding. Both tables refuse `DELETE` and `TRUNCATE`.

Every object is pinned by name in `ledger-schema.int-spec.ts`, because `prisma migrate
diff` sees neither CHECK constraints, partial indexes nor triggers and would let one
disappear silently.

The lock order extends Milestone 4's rather than competing with it: `appointment` first
for anything that can create a charge, then `session_charge`, then `charge_adjustment`.
No path takes them the other way round.

A table owner can still `ALTER TABLE ... DISABLE TRIGGER`. Since Milestone 10 the API
is not the owner and cannot — see [Database roles](#database-roles).

### Verification

Beside the automated suites, the integrated milestone was walked through end to end
against the **real local API and web stack** with synthetic data only — no real clinic
record, name or amount was used at any point.

The walkthrough confirmed, in the browser: two children of one family each traceable to
their own charges; a charge posting automatically from whichever of completion and
attendance was recorded last; a `FREE` session and an unpriced one rendering as visibly
different states; a clinic-funded discount reducing the effective amount while the
original amount and the whole history stayed readable; a discount larger than the
remaining amount being refused; a charge void changing the derived totals while the row
stayed visible as history; a reopen refused while a valid charge stood; the approved void
→ reopen → re-complete sequence raising a new charge with the old voided charge and its
concession preserved beside it; a re-post pricing the session from its **service date**
rather than from today; an adjustment void restoring the amount and keeping both reasons;
the history filters changing what is listed without changing any total; and a
receptionist reading the account and posting a charge while seeing no manager correction
control at all. Persian RTL reading order, Jalali dates and toman presentation were
correct throughout, at both desktop and narrow widths.

**One limitation, stated precisely.** Live browser rendering was exercised, but
screenshot capture was unavailable in the review environment. The visual checks were
therefore made against the rendered browser state and layout measurements — text and
reading order, computed direction, and element-versus-container widths at 1280 and 375
pixels, which found no overflow or clipping — rather than against captured images. A
pixel-level aesthetic pass remains a human step.

### Accepted risks and revisit triggers

None of these is a correctness, security or data-integrity issue, and none is committed
scope for a later milestone.

1. **Correction redirects lose the family account's filter and page state.** After a
   void or a concession the account reopens unfiltered on the first page. Revisit if it
   proves to be friction on longer histories.
2. **A completed, attended participant whose charge was voided and is awaiting a re-post
   has no dedicated day-view signal.** The appointment detail states it plainly; the day
   card stays deliberately minimal. Revisit if pilot use shows re-posts being missed.
3. **The day view reads participant charges one request per participant.** Revisit only
   if measured pilot latency warrants it — a batch read, not a cache, would be the
   answer.

## Family money in (Milestone 6)

Money arriving. A **payment** records that a family handed the clinic money; a
**payment promise** records that a family said it would; and the family account now states
a **financial position** — what the whole family was charged, what it has paid, and what is
therefore due or standing to its credit — derived on every request.

Nothing here is allocated. A payment names no charge, no session and no child: balance is
family-level, and the per-child, per-session charge detail from Milestone 5 is what still
explains where the debt came from.

### Scope, and what is deliberately absent

Built: family-level payment recording in `CASH`, `CARD` or `TRANSFER` with an optional bank
reference and note; unbounded back-dating and a server-side refusal of a future receipt
date; manager-only payment void, which keeps the row whole and visible; paginated payment
history with an `includeVoided` filter; payment promises with derived `MISSED`; fulfil,
reschedule and cancel, all reasoned and audited; and the whole-family position on
`GET /families/:id/account`.

Not built, and each for a stated reason:

| Absent                                                     | Why                                                                                                                                                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Payment-to-charge allocation, and partial fulfilment**   | A payment is a family fact (DECISION_LOG, 2026-08-15). There is no row for a portion to live in, and one payment settles at most one promise, wholly or not at all.     |
| **A stored balance, credit or paid-total column**          | Every figure in `position` is derived from `session_charge`, `charge_adjustment`, `payment` and `payment_promise` on each read. A cached total drifts; the rows do not. |
| **A `PENDING` payment status**                             | Money is recorded when the receptionist is holding it. Confirmed or voided, and nothing else (DECISION_LOG, 2026-08-15).                                                |
| **A stored `MISSED` promise status**                       | It is an `OPEN` promise whose due day is past at the clinic. Storing it would need a nightly job and would read wrongly until it ran.                                   |
| **`CHEQUE`, `OTHER`, refunds, un-void, editing a payment** | A cheque has a lifecycle nothing here models; `OTHER` is the value no report can say anything about; a wrong payment is voided and re-recorded, never rewritten.        |
| **Pre-Milestone-6 paper debt and opening balances**        | The position knows only this system's records, and every screen that shows it says so in Persian.                                                                       |
| **Therapist settlement and shares**                        | Milestone 8, and not approved. No column here stores a percentage or a share.                                                                                           |

No real clinic data appears anywhere. Every fixture, test and example is synthetic
(PROJECT_SPEC.md 17).

### The position, and why it sits beside a total that means something else

`GET /families/:id/account` returns two blocks of money that look alike and are not.
`totals` describes **the charge view the query asked for** and moves when the reader narrows
to one child or one month. `position` answers **what this family owes** and is computed over
every valid charge and every confirmed payment of the family, whatever `childId`, `from`,
`to` or `includeVoided` say. They are derived by separate statements under one
`REPEATABLE READ` snapshot, so a payment committing mid-read cannot produce a response whose
balance does not follow from its own parts.

`amountDueToman` and `creditToman` are both unsigned and both always present, and **at most
one is non-zero** — there is no signed balance whose meaning lives in a minus sign. A
prepayment, an overpayment and a credit consumed by a later charge are all the same
subtraction over rows; nothing is stored and nothing is consumed. Promises are **counted,
never summed**: a promised total beside an amount due would be an invitation to subtract one
from the other.

The route requires `charge.read`, `payment.read` **and** `promise.read`, because the response
carries all three.

### Voiding money, and what a void does not do

A payment void is `payment.void`, the manager's alone, with no same-day receptionist window.
It writes three columns beside a row that is otherwise untouched — the amount, method,
family, received day, reference, note, entry instant and entry actor all survive — and it is
one-way in both the service and the database. Voided money is an **absence from the sum**,
not a negative entry, which is why voiding a payment restores exactly the position that
stood before it.

A void does **not** touch a promise the payment fulfilled. The promise stays `FULFILLED` and
its linked payment now reads `VOIDED`; the web shows both, and says in Persian that the
evidence no longer stands. Forcing the promise back open would rewrite a judgement a person
actually made.

### Audit and privacy

Every financial mutation writes exactly one audit row, in the same transaction as the write,
so an unaudited payment cannot exist. The vocabulary is `payment.recorded`,
`payment.voided`, `payment_promise.created`, `payment_promise.fulfilled`,
`payment_promise.rescheduled` and `payment_promise.cancelled` — three promise actions under
one `promise.resolve` permission, because "how often does a family reschedule rather than
pay?" is not a question you can answer from a status diff.

The **bank reference is never copied into audit**; only whether one exists is recorded
(DECISION_LOG, 2026-08-15). Notes are written in full, because the note is the fact being
recorded. No guardian name, phone number, file number or child id appears in any payment or
promise audit payload, and **reads write no audit rows at all** — `audit_log` is append-only
and permanent, and a financial read copied into it would be a second undeletable store of
what a family paid, growing with every refresh.

### Verification

Beside the automated suites, the integrated milestone was walked through end to end against
the **real local API and web stack** with synthetic data only — no real clinic record, name
or amount was used at any point.

The walkthrough confirmed: a family with two children whose sessions stay individually
explainable beside a family-level position; a partial payment leaving a due; an exact
settlement reading as settled; an overpayment becoming credit; a prepayment on a family with
no charges being pure credit; a later charge consuming that credit; a receptionist recording
a back-dated payment from the browser with a Persian-digit amount and a Jalali date; a
future receipt date refused; a receptionist seeing no void control and being refused by the
API when the route is reached anyway; a manager void restoring the prior position while the
row stayed visible as history; a promise born with a past due date reading as derived
`MISSED`; an ordinary `OPEN` promise; a too-small and a voided payment both refused for
fulfilment; an equal-or-larger payment fulfilling; the same payment refused for a second
promise; a reschedule preserving its predecessor and linking to its successor; a successor
date in the past refused; a cancel preserving its reason; and a fulfilled promise whose
payment was later voided staying `FULFILLED` with the payment reading `VOIDED`. Persian RTL
reading order, Jalali dates, Persian numerals and toman presentation were correct
throughout, at both desktop and narrow widths, with the family money navigation scrolling
inside its own container rather than the page.

**One limitation, stated precisely.** As in Milestone 5, screenshot capture was unavailable
in the review environment. Visual checks were made against the rendered browser state and
layout measurements — text and reading order, computed direction, and
element-versus-container widths at 1280 and 375 pixels — rather than against captured
images. A pixel-level aesthetic pass remains a human step.

### Accepted risks and revisit triggers

None of these is a correctness, security or data-integrity issue, and none is committed
scope for a later milestone.

1. **Two identical payments entered twice are two payments.** There is no idempotency key:
   two families really can hand over the same amount in the same way on the same day, and
   the system cannot tell a duplicate entry from a genuine repeat. The entry panel shows
   recent payments beside the form for exactly this reason. Revisit if pilot use produces
   real duplicates.
2. **The fulfil picker proves only what the payment list states.** It filters on `CONFIRMED`
   and amount, and never claims a candidate is unused; the server remains authoritative for
   `PAYMENT_ALREADY_FULFILS_PROMISE` (DECISION_LOG, 2026-08-16).
3. **Promise workflows are bounded by one page of history.** Fulfilment candidates come from
   the first 100 payments, and promise chain links are in-page anchors (DECISION_LOG,
   2026-08-16).

## Dashboard and reports (Milestone 7)

One operational screen and five reports, all of them reads. Milestone 7 adds no
table, column, constraint or trigger, stores no balance and no aggregate, and
derives every figure on the request that asks for it.

```text
GET /dashboard                            today, at a glance
GET /reports/sessions                     operational
GET /reports/promises                     operational
GET /reports/therapist-activity           operational
GET /reports/payments                     financial, manager-only
GET /reports/family-accounts              financial, manager-only
GET /reports/{report}/export              CSV, manager-only, audited
```

### Scope, and what is deliberately absent

Present: the dashboard, the five reports, a readable print treatment, manager-only
CSV export with one audit row per export, and a synthetic-clinic seeder for local
review at a realistic size.

Absent, and each of these is a decision rather than an omission:

- **no therapist share, settlement or session value anywhere**, including in the
  therapist activity report and its CSV — the rules are unapproved (CLAUDE.md);
- **no payment-to-charge allocation**, because a payment names no charge;
- **no opening balance and no pre-system paper debt**, because no such row exists;
- **no PDF, no receipt and no formal statement** — print is a stylesheet;
- **no charts and no analytics**;
- **no `follow_up_date`, no reminder queue and no automated follow-up**;
- **no new financial correction authority** — nothing in Milestone 7 writes a
  financial fact;
- **no stored or cached figure of any kind**;
- **no free-text search on any report.** Every filter is an opaque id, a calendar
  date or a closed enum, so no child's or guardian's name reaches a query string,
  the browser history, a `Referer` header or an access log. A family is chosen by
  search — which is a POST — and then filtered by id.

### Which business day a figure is keyed on

This is the one thing to read before comparing two numbers. Every ranged response
states its basis on the wire, from a closed vocabulary of four:

- **`SESSION_DATE`** — the clinic day the session sits on. The session report, the
  therapist activity report, and the dashboard's clinic-wide charge block.
- **`PAYMENT_RECEIVED_ON`** — the business day the money arrived. The payments
  report.
- **`PAYMENT_RECORDED_AT`** — the clinic day a payment was **entered**. The
  dashboard's daily reconciliation.
- **`PROMISE_DUE_ON`** — the day the family said it would pay. The promise report.

**The dashboard's reconciliation and the payments report will disagree, and both
are correct.** Money taken last Thursday and entered this morning is in this
morning's reconciliation — what a till is balanced against — and in last
Thursday's takings. Neither is a correction of the other.

Every clinic day is `Asia/Tehran`, decided by PostgreSQL's `clinic_date()`, never
by the reader's timezone.

### The dashboard

`GET /dashboard` is a single aggregation inside one `REPEATABLE READ` transaction,
so the badge and the list beneath it cannot describe two different states of the
clinic. It reuses the authoritative reads rather than restating them: the
appointment counts and the `MISSING` tariff verdict are `AppointmentReadService.day`,
the charge totals are the same SQL the family account uses, and derived `MISSED` is
written exactly as the family position writes it.

It states, for one clinic day: the appointment counts including unresolved
outcomes, the count of **authorised availability overrides**, promises due today
and every overdue promise clinic-wide, two data conditions, and the caller's own
recorded payments.

- **The two data conditions are not one condition counted twice.**
  `missingTariffCount` counts appointments no price list covers — a warning to fix
  before completion — and `unchargedCompletedSessionCount` counts completed,
  attended seats carrying no valid charge, which is money the clinic has earned and
  not recorded. Recording a tariff clears the first and leaves the second standing,
  because nothing re-posts retrospectively; voiding a charge produces the second
  with no tariff ever missing. **They must not be added together.**
- **`availabilityOverrideCount` is not a conflict backlog.** Hard therapist, room
  and child conflicts are refused by exclusion constraints at booking time, so
  there is nothing to list. What the count answers is "how many of today's sessions
  did somebody have to authorise?" A cancelled session drops out while keeping its
  recorded override.

**The response has two shapes, and which one you get is your authority.** A caller
without `report.read_financial` receives `financialScope: 'OWN_ENTRIES_ONLY'` — a
strict object with **no clinic-wide financial key at all**, not a nulled or zeroed
one. A caller holding it receives `CLINIC_WIDE`, where `clinicFinancial` is
required. For an unauthorised caller the clinic-wide statements are never executed,
so those totals do not exist in the process to be serialised by mistake.
`reconciliation` is in both shapes and is always the authenticated actor's own
entries; the query carries no user parameter and a caller that invents one is
refused.

### Operational reports

Read under the authorities that already describe the data, and **both roles hold
them**. None reads a single field of money, which is exactly why.

- **`GET /reports/sessions`** (`appointment.read`) — sessions by date, family,
  child, therapist, service, room, booking status and attendance. `status` filters
  the booking and `attendance` filters the seat: they are two different questions,
  and a completed booking may still carry `PENDING`, which is the unresolved-outcome
  backlog. Cancelled sessions stay visible.
- **`GET /reports/promises`** (`promise.read`) — promises across the clinic, keyed
  on the due date. `MISSED` is accepted as a filter and returned as a status though
  **PostgreSQL has no such value**: the server derives it from `OPEN` plus a due
  date before the clinic's today. The five wire statuses partition the result, so
  the counts add up. A promise reduces no balance in any state.
- **`GET /reports/therapist-activity`** (`appointment.read`) — counts and durations
  per therapist, unpaged because the rows are read against one another.
  `attendedDurationMinutes` is the only duration and counts attended seats alone;
  cancelled and no-show counts sit beside it, unsummed. **No share, rate, session
  value or settlement figure appears anywhere in it.**

### Financial reports, and the permission boundary

Manager-only, in a controller of their own, refused by `PermissionsGuard` on a
direct call. Milestone 7 adds two permission names and grants the receptionist
neither: **`report.read_financial`** and **`report.export`**.

- **`GET /reports/payments`** — every payment in a period on `receivedOn`, with
  totals by method and by recording user. `recordedByUserId` is an id, never a
  username. `includeVoided` defaults to **true**, as every financial list in this
  system does: history is visible unless somebody asks to hide it, and it is a
  filter on the list only — a voided payment is in no confirmed total either way.
  No row says what a payment settled, because no allocation exists.
- **`GET /reports/family-accounts`** — every family's position on one page,
  largest amount due first. **Each row's position is the same code
  `GET /families/:id/account` answers with**, so the report and the single-family
  account reconcile by construction; an integration test asserts that equality
  family by family against a whole synthetic clinic. It **takes no date range** —
  a position is not a period — and `standing` / `includeInactive` select which
  families are listed and narrow no figure. `totalAmountDue` and `totalCredit` are
  never netted against each other, and no clinic-wide balance is stated anywhere in
  Milestone 7.

**What these figures know is only what this system holds.** There is no opening
balance and no pre-system paper debt in them. The screen prints that qualification
beside the report, and the CSV carries it too.

A report READ writes **no audit row**. `audit_log` is append-only and permanent,
and copying a financial read into it would build a second undeletable store of who
owes what, growing with every refresh.

### Print

Every report, the dashboard and the family account offer a print control. The
treatment is one `@media print` block: application chrome, filter forms and
controls are hidden, table headings repeat across pages, rows avoid breaking, the
page prints A4 landscape, and Persian RTL, Persian numerals, Jalali dates and
toman are preserved. Where a financial position appears, the system-record-only
disclosure prints with it.

**No PDF is generated and nothing is framed as a receipt or a formal statement** —
no receipt number, no "official statement" wording, no signature block.

### CSV export, and the one audit row

Five reports export as `text/csv; charset=utf-8` with an attachment disposition and
`nosniff`. **All five are manager-only, including the three operational reports a
receptionist reads all day**: each route names its report's read authorities _plus_
`report.export`, so revoking a read takes its export with it and `report.export`
alone opens nothing. Errors stay JSON — a caller never receives a `.csv` file
containing an error. The dashboard is deliberately not exportable.

A file is the **whole filtered result**: the export schemas refuse `page` and
`pageSize`, and nothing truncates. Every row comes from the owning report service's
`exportRows`, which is the screen's own statement with the paging window removed —
there is no second reporting implementation behind a download, so the same request
gives byte-identical files and a spreadsheet cannot disagree with the screen.

The bytes are written for a Persian Windows spreadsheet: a **UTF-8 BOM** (without
it Excel opens every Persian name as mojibake), CRLF terminators, every field
quoted, ASCII digits, and money exactly as the wire carries it — a plain integer
string of whole toman. Cells beginning `=`, `+`, `-`, `@`, a tab or a carriage
return are neutralised in free-text columns only, so the server's own numbers stay
machine-parseable. **One caveat:** Excel splits a `.csv` on the reader's Windows
list separator rather than on the comma, so a machine configured with a semicolon
opens these files in one column until the reader imports them or changes the
setting. The files are RFC 4180, which is what every other consumer reads.

The **family-accounts CSV carries its scope in the file** — a constant first
column, `SYSTEM_RECORDS_ONLY`, under a Persian heading saying these figures are
only this system's records with no opening balance or pre-system debt. A CSV is
read months later beside no screen.

**Exactly one `report.exported` audit row per successful export**, written in the
same transaction as the read, so `rowCount` is provably the count the caller
received. A refused export writes nothing. The row records the **act, never the
contents**: surface, `format`, the range and its basis (explicitly `null` for
family accounts), the filters supplied, and the row count. It is structurally
impossible to pass a row to the payload builder, so no amount, total, balance,
resolved name, personal identifier, bank reference or free text can reach the
trail.

### Permissions

| Permission              | Manager | Receptionist |
| ----------------------- | ------- | ------------ |
| `report.read_financial` | yes     | no           |
| `report.export`         | yes     | no           |

The operational reads and the dashboard add no permission. Reading the dashboard
requires `appointment.read`, `charge.read`, `payment.read` **and** `promise.read`
— all four, because it states a ledger fact among the others.
`report.read_financial` does not gate the dashboard route; it selects the response
variant.

### Persian pages

| Path                          | Who                      |
| ----------------------------- | ------------------------ |
| `/` (the signed-in landing)   | both roles, two variants |
| `/reports/sessions`           | both roles               |
| `/reports/promises`           | both roles               |
| `/reports/therapist-activity` | both roles               |
| `/reports/payments`           | manager                  |
| `/reports/family-accounts`    | manager                  |

Each page gates on exactly the authorities its route demands, from the same list
in `@clinic/contracts` the route names, so the two cannot drift. The export button
appears only for a holder of `report.export` and carries the page's current
filters, never only the visible page. Filter submission is a POST that redirects
with ids and enums in the URL; no name is ever placed there. **The web tier
performs no financial arithmetic** — every total, balance and derived status
arrives from NestJS.

### Database objects

Three B-tree indexes, and nothing else:

```text
session_charge(service_date)   what the clinic charged for a day's sessions
payment(received_on)           what the clinic took in, by business day
payment(created_at)            what was entered on a clinic day
```

Every existing index on the financial tables leads with a family, a child or a
seat, so a date-only predicate could not use one at all. Nothing is added to
`payment_promise` or `appointment`, whose existing indexes already serve these
predicates, and no partial index over non-voided rows exists — reports show voided
rows by default.

### The synthetic clinic

For local review at a realistic size. It writes through the **real domain
services**, parses every request with the same contract schema the controller
would, and is additive — it never truncates, deletes or disables a trigger.

```bash
pnpm --filter @clinic/api build
```

```bash
DATABASE_URL='postgresql://clinic_app:clinic_app_dev_only@localhost:5433/clinic_dev?schema=public' pnpm --filter @clinic/api exec node dist/dev/main.js --confirm --weeks 5 --families 12
```

It refuses to run unless `NODE_ENV` is not production **and** the database name
ends in `_dev`, `_test`, `_ci` or `_demo`, **and** `--confirm` was passed. It is a
separate binary from the operator CLI on purpose. It needs a real manager account
to act as and refuses to create one — bootstrap one first. Synthetic staff
accounts it creates print their temporary password once to stdout, never through
the logger.

Everything it writes is invented in `apps/api/src/dev/synthetic-clinic.ts`. There
is no import path, fixture file or argument through which real data could reach it.
**Never point anything at real clinic data.**

To start clean, drop and recreate the local database and re-run the migrations —
there is no `--reset`, because financial rows cannot be deleted by design.

One consequence worth knowing: every seeded payment carries the run's own
`created_at`, so the **daily reconciliation is rich for the day of the run and
empty for earlier days**. Back-dated `receivedOn` still exercises the two payment
bases against each other.

### The practice clinic

The reconciled two-month clinic of Milestone 10 (A5), for the walkthrough, the
operator guide screenshots and staff practice. It needs an **empty** disposable
database with one manager from `bootstrap-manager`, and refuses otherwise:

```bash
DATABASE_URL='postgresql://clinic_app:clinic_app_dev_only@localhost:5433/clinic_demo?schema=public' pnpm --filter @clinic/api exec node dist/dev/main.js --confirm --practice-clinic
```

It runs from three weeks before the previous Jalali month to yesterday, closes
the previous Jalali month for settlement, acts through the staff services as a
manager, two receptionists and a visitor (each act checked against the route ×
role matrix), then reconciles every balance, day, month, settlement line and
audit entry independently of the report code. It prints each check and exits
non-zero on any discrepancy. See `docs/M10_A5_PERMISSION_REVIEW.md`. It is not a
way to manage real website content.

### The route × role matrix

`docs/PERMISSION_MATRIX.md` is generated from the route decorators and the role
map and pinned by `apps/api/src/auth/route-access-matrix.spec.ts`. After adding a
route or changing what one requires, regenerate it and review the diff:

```bash
UPDATE_PERMISSION_MATRIX=1 pnpm --filter @clinic/api exec jest src/auth/route-access-matrix.spec.ts
```

### Verifying Milestone 7 locally

The repository-wide gate, which needs no database:

```bash
pnpm check
```

The database-backed suite, which is where the reporting invariants are proved —
see [Integration tests](#integration-tests) for the disposable-database setup:

```bash
DATABASE_URL='postgresql://clinic_app:clinic_app_dev_only@localhost:5433/clinic_test?schema=public' TEST_OWNER_DATABASE_URL='postgresql://clinic_owner:clinic_owner_test_only@localhost:5433/clinic_test?schema=public' INTERNAL_API_KEY=<32+ synthetic characters> MEDIA_STORAGE_DIR=<a scratch directory> pnpm test:int
```

`INTERNAL_API_KEY` and `MEDIA_STORAGE_DIR` are here because the operator CLI
suites build a real NestJS context, which validates the whole API environment.
The HTTP suites do not read either: the harness supplies its own synthetic key
and its own per-process temporary media root, so nothing a test writes lands in
the directory named above.

Migration status and schema drift, exactly as
[CI](.github/workflows/ci.yml) runs them — `migrate status` catches an unapplied
migration and `migrate diff` exits 2 if `schema.prisma` was edited without one:

```bash
DATABASE_URL='postgresql://clinic_owner:clinic_owner_test_only@localhost:5433/clinic_test?schema=public' pnpm --filter @clinic/api exec prisma migrate status
```

```bash
DATABASE_URL='postgresql://clinic_owner:clinic_owner_test_only@localhost:5433/clinic_test?schema=public' pnpm --filter @clinic/api exec prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datasource prisma/schema.prisma --exit-code
```

Neither sees the hand-written CHECKs, triggers or the protected-row function;
those are pinned by name in the integration suite's catalogue assertions.

The Milestone 7 suites, and what each one is for:

- **`dashboard`** — both authority shapes, the own-entries reconciliation, the two
  data conditions, the override count, and a quiet day.
- **`reports-sessions`, `reports-promises`, `reports-therapist-activity`** — the
  operational reads, derived `MISSED`, and the absence of money.
- **`reports-payments`, `reports-family-accounts`** — the financial reads and the
  manager-only refusal.
- **`reports-operational-synthetic`** — the operational reports against a whole
  synthetic clinic.
- **`reports-financial-synthetic`** — **every family's report row equals that
  family's own account**, and the two payment bases against each other.
- **`reports-export`** — the receptionist refusal, exactly one audit row per
  successful export, no exported value in audit, byte-identical repeat exports, and
  the family-accounts scope column.
- **`reporting-schema`** — the three indexes, and the absence of any new object.
- **`synthetic-clinic`** — the seeder's preconditions, and that it writes through
  the real services.

For a screen-level review, seed the synthetic clinic (above), sign in, and read
`/` — the dashboard is the signed-in landing page, not `/dashboard` — and
`/reports/*`, as a manager and again as a receptionist. The receptionist must be
refused `/reports/payments` and `/reports/family-accounts`, and must see no export
control anywhere.

### Verification

Beside the automated suites, the integrated milestone was walked through end to end
against the **real local NestJS, PostgreSQL and Next.js stack** with synthetic data
only — a seeded clinic of 12 families, 16 children, 4 therapists, 372 appointments
across six weeks, 150 charges, 15 payments and 12 promises. No real clinic record,
name or amount was used at any point.

Every figure below was reconciled against the rows underneath it, by SQL or by the
authoritative read it claims to agree with:

- **the dashboard** — appointment totals, cancellations and unresolved outcomes
  against the diary; the availability-override count against the recorded override
  fact; `missingTariffCount` against the day view's own badge and
  `unchargedCompletedSessionCount` against the ledger's `voided_at IS NULL`
  predicate, the two staying distinct and unsummed; promises due today and derived
  `MISSED` against `payment_promise`, with **no stored `MISSED` row anywhere**; a
  manager's own reconciliation (5 entries) as a strict subset of the clinic-wide
  block (14), with the per-user attribution summing exactly to the clinic total;
- **the authority boundary** — a receptionist's dashboard carrying **no
  clinic-wide financial key at all**, and an invented `userId` parameter refused as
  `VALIDATION_FAILED`;
- **the operational reports** — 372 seats matching the diary; booking status and
  seat attendance preserved as two separately filterable facts; cancelled sessions
  still listed; the five promise statuses partitioning the period exactly;
  therapist activity summing to the same 210 attended seats with no money, share,
  rate or settlement field anywhere in it;
- **the financial reports** — payments keyed on `receivedOn`, with 10 genuinely
  back-dated payments in the data and one confirmed to appear under the day the
  money arrived rather than the day it was entered; voided rows shown by default
  and excluded from every confirmed total, and hiding them changing the list
  without moving a figure; **every one of the 12 families' report rows equal to
  that family's own `GET /families/:id/account` position**, covering 7 owing, 3 in
  credit and 2 exactly settled;
- **export and audit** — a receptionist refused all five exports on direct API
  calls; a manager's CSV arriving with a UTF-8 BOM, CRLF, every field quoted and
  ASCII digits; two identical requests producing byte-identical files; the whole
  filtered period in the file with no paging; **exactly one `report.exported` audit
  row per successful export and none for a refusal, a validation failure or any
  read**; that row naming the surface, format, range, basis, filters and row count
  and carrying no family name, no amount and no identifier; and the
  system-record-only scope column present on the family-accounts file alone.

On the Web tier, the production build was driven through the real BFF with real
sessions. Persian RTL (`dir="rtl"`, `lang="fa"`), Persian numerals, Jalali dates
(`۲۴ مرداد ۱۴۰۵`) and toman were correct on the dashboard, all five reports and the
family account, with no Gregorian year and no Latin digit in any formatted value.
The print control is present on all seven surfaces; the system-record-only
disclosure prints with the family account; no receipt or formal-statement framing
appears anywhere. A receptionist received a content-free shell on both financial
report pages — no money, no amount key, no family name in the payload — while
receiving the full page on the reports they may read, and saw no export control on
any page. Layout was measured at **1280 and 375 pixels on every M7 page**: no
body-level overflow and no element wider than the narrow viewport.

**Two limitations, stated precisely.** Screenshot capture and native print preview
were both unavailable in the review environment — the browser pane does not
composite frames, so client-side React never finishes and each page shows its
loading fallback in the live DOM. Every observation above was therefore made
against the **server-rendered HTML fetched over an authenticated session**, and the
layout measurements against that same markup rendered with the shipped stylesheet
in a sized frame, rather than against captured images or a real print dialogue. The
print rules were verified as present and correctly targeted in the production CSS
bundle — A4 landscape, chrome and controls hidden, table headings repeating via
`display: table-header-group`, rows avoiding breaks, tables unclipped — and the
markup carries the classes those rules target. **A pixel-level pass and a real
printed page remain human steps.**

### Accepted risks and revisit triggers

None of these is a correctness, security or data-integrity issue, and none is
committed scope for a later milestone.

1. **No server-side maximum report span.** A deliberately enormous range is
   answerable and therefore expensive; nothing in the contract stops it. Revisit on
   measured evidence at pilot volumes — any numeric bound is a cost bound argued
   from a query plan and needs owner approval (DECISION_LOG, 2026-08-18).
2. **Every figure is derived per request, over three indexes and no stored
   aggregate.** A wide clinic-wide read costs a wide read. Revisit when a report's
   plan shows a sort or a join dominating at real data volumes — the answer is a
   query plan, not a stored balance, which would be a second source of financial
   truth.
3. **A CSV export materialises the whole file in memory.** Nothing pages and
   nothing truncates, so several years of sessions builds every row and the string
   made from them. A silently shortened financial file is the worse failure.
   Revisit when an export is large enough to strain the process, at which point
   streaming from a cursor is the change to make.
4. **Excel may open these CSVs in a single column.** The files are RFC 4180 with a
   comma delimiter; Excel splits on the reader's Windows list separator. A machine
   configured with a semicolon needs an import step or a settings change
   (DECISION_LOG, 2026-08-18).
5. **The financial position covers only this system's records.** No opening balance
   and no pre-system paper debt exists to include. The screen states this and the
   family-accounts CSV carries it as a constant column; it stops being true, and has
   to change, if opening balances ever enter scope.
6. **The synthetic clinic's reconciliation is rich only for the day of the run**,
   because a payment's entry instant cannot be back-dated without bypassing its
   immutability rule. Revisit if a pilot rehearsal needs entry days spread across
   weeks (DECISION_LOG, 2026-08-18).
7. **Print output is the browser's.** Pagination and margins vary a little between
   browsers, and no artefact of what was printed is archived. The rules are verified
   as present and correctly targeted in the shipped CSS; a real printed page and a
   pixel-level pass remain human steps (see Verification).
8. **One integration assertion is sensitive to host/container clock skew.**
   `payment-void.int-spec.ts` brackets a PostgreSQL `transaction_timestamp()`
   against Node's `Date.now()`, so a few milliseconds of drift between the host and
   the database container can fail it; it passed 5/5 on re-run. It is a Milestone 6
   test and the fix — read the instant from the database, as the fixtures already do
   (DECISION_LOG, 2026-08-06) — is left to whoever next touches that suite.

## Therapist settlement (Milestone 8)

What a completed session earned the therapist who delivered it, snapshotted at the
moment it is decided and never recalculated afterwards. Settlement is **based on
completed-session value regardless of whether or when the family pays**
(CLAUDE.md), so nothing in this milestone reads a payment.

```text
GET  /settlement/share-rules                       the agreed percentages
GET  /settlement/share-rule-resolution             which rule a date resolves to
POST /settlement/share-rules                       write one
POST /settlement/share-rules/{id}/void             withdraw one
POST /settlement/session-charges/{id}/rating       decide one session
GET  /settlement/session-charges/{id}/rating       read that decision
POST /settlement/session-ratings/{id}/void         withdraw a decision
POST /settlement/rating-corrections                void and replace, atomically
GET  /settlement/statement                         a therapist, a date range
GET  /settlement/statement/export                  CSV, audited
POST /settlement/periods                           close a period, irreversibly
GET  /settlement/periods                           what has been closed
GET  /settlement/periods/{id}/lines                a closed period, line by line
```

### Scope, and what is deliberately absent

Present: effective-dated share rules per therapist, a per-session settlement fact
carrying the applied percentage as a snapshot, the therapist/clinic split of a
session concession, a statement covering a therapist and a date range, its
manager-only CSV, and irreversible period close with materialised lines.

Absent, and each of these is a decision rather than an omission:

- **no therapist-facing account, screen or permission.** A therapist cannot sign
  in — there is no therapist portal in the initial scope (PROJECT_SPEC.md) — so a
  permission naming them would describe a role that cannot log in. A therapist
  sees their settlement because a manager shows it to them.
- **no payment to the therapist.** The statement says what was earned. Money
  leaving the clinic is not modelled anywhere in this product.
- **no `therapist_share.update`.** A rule is never edited; a correction voids the
  row and writes a replacement, exactly as a tariff does.
- **no un-close.** A closed period is immutable and is never reopened, which is
  why `settlement.close` is its own authority rather than a side effect of being
  allowed to read a statement.
- **no per-service or per-programme rate.** A share rule is scoped to the
  therapist and to nothing else (DECISION_LOG, 2026-08-19).

### Share rules

A rule names a therapist, a percentage in basis points and an effective range. An
exclusion constraint (`therapist_share_rule_no_overlap_excl`) makes overlapping
ranges for one therapist impossible in the database rather than in a service, so
"which rule applies on this date" always has exactly one answer or none. A rule
may be written for an inactive therapist (DECISION_LOG, 2026-08-19), because
settlement outlives employment.

`SHARE_RULE_NOT_FOUND` is refused rather than defaulted. There is no fallback
percentage anywhere: a share rule is the only source of settlement policy
(DECISION_LOG, 2026-08-19).

### The session settlement fact

`session_settlement` records what one completed session earned, and it holds the
applied percentage as a **snapshot** — not a foreign key that could be followed to
a rule somebody later changed. It is bound to its charge by a composite foreign
key over `(id, appointment_participant_id, therapist_id, service_date,
amount_toman)`, so the charge's identifying facts cannot drift out from under the
settlement that was computed from them.

Voiding a charge leaves the applied share snapshot standing (DECISION_LOG,
2026-08-19). The historical record of what was decided survives the correction of
what it was decided about.

### Concessions, and where the floor is

A session discount may be borne entirely by the clinic, entirely by the therapist,
or split (CLAUDE.md). The therapist-borne and clinic-borne amounts must sum to the
family's total discount, and that is enforced by
`enforce_charge_adjustment_bounds` and
`enforce_session_settlement_allocation_guard` as database triggers, not as
service-layer arithmetic.

**Therapist net share is never negative and the family's effective charge is never
negative.** **Clinic net may be negative**, and a negative clinic net is an
explicit clinic subsidy that must stay visible in reports and fully audited
(CLAUDE.md). For a therapist who does not participate in discounts, the
therapist-borne amount is zero and the clinic bears the whole discount even when
that makes clinic net negative.

### Closing a period

Closing materialises `settlement_line` rows — `PRIMARY` for each rated session and
`CORRECTION` for each adjustment landing after an earlier close — and
`settlement_line_one_primary_per_charge_uq` makes a second primary line for one
charge impossible. A closed period is a record of what a close made final; nothing
rewrites it (DECISION_LOG, 2026-08-19).

### Permissions

Seven manager-only names, and the receptionist holds none of them:
`therapist_share.read`, `therapist_share.create`, `therapist_share.void`,
`settlement.read`, `settlement.rate`, `settlement.void_rating`,
`settlement.close`. Taking the statement out of the building is `settlement.read`
**and** `report.export` — the Milestone 7 authority, not a second export name.

### Persian pages

`/settlements` lists therapists and their periods; `/settlements/{therapistId}` is
the statement; `/settlements/periods/{id}` is a closed period line by line.

### Database objects

`therapist_share_rule` and `session_settlement` (Milestone 8's two facts),
`settlement_period` and `settlement_line` (what a close materialises), the
`session_rated_via` and `settlement_line_type` enums, two allocation triggers, and
composite unique indexes on `session_charge` that exist only so the snapshot
foreign keys above can be declared.

## Public website (Milestone 9)

The clinic's public site, the anonymous evaluation request behind it, and the
internal inbox that answers one. This is the first surface in the product built
for **people who are not its patients**, and the privacy consequences drive most
of its design.

```text
GET  /public/services                     published services
GET  /public/services/{slug}
GET  /public/team                         therapists who opted in
GET  /public/team/{slug}
GET  /public/clinic-profile               address, telephone, hours
GET  /public/articles                     published articles
GET  /public/articles/{slug}
GET  /public/testimonials                 approved and published
GET  /public/sitemap                      kind and slug, never a path or a host
POST /public/requests                     the anonymous evaluation request

GET   /content/articles                   internal; drafts are unreadable elsewhere
POST  /content/articles
PATCH /content/articles/{id}
PATCH /content/articles/{id}/publication
GET   /content/testimonials
POST  /content/testimonials
PATCH /content/testimonials/{id}
PATCH /content/testimonials/{id}/approval
PATCH /content/testimonials/{id}/publication
GET   /content/clinic-profile
PATCH /catalog/therapists/{id}/public-profile
PATCH /catalog/therapists/{id}/public-profile/visibility

GET   /website-requests                   the inbox
GET   /website-requests/{id}
PATCH /website-requests/{id}/status
POST  /website-requests/{id}/link         link to a family somebody registered
```

### Scope, and what is deliberately absent

Present: the public read side, publication as two facts on the catalog row rather
than a published copy of it, articles and testimonials as two tables that are not
a CMS, the anonymous request with its abuse controls and consent columns, the
inbox with its lifecycle and conversion, the ninety-day erasure command, and the
public pages themselves in the frozen Hamrah visual direction.

Absent, and each of these is a decision rather than an omission:

- **no online booking and no online payment.** The public action registers
  information; the clinic reviews it and contacts the family. It never implies a
  booking and never promises a response time.
- **no parent portal and no public account of any kind.** The public reads hold no
  permissions and the public write creates no user.
- **no internal identifier on any public contract.** The public projections are
  purpose-built and carry slugs, never row ids (DECISION_LOG, 2026-08-21).
- **no free-text search on the inbox.** Searching it by telephone number would
  make it a way to ask "has this person contacted the clinic?" of a store the
  clinic has promised to erase.
- **no client metadata in the submission's audit row** — no IP address, no user
  agent. The audit records the act and nothing else (DECISION_LOG, 2026-08-27).
- **no `article.delete` and no `testimonial.delete`.** Published content is
  withdrawn, not erased; the database refuses a DELETE on both tables.
- **no CMS, no template system and no arbitrary content type.** Public copy is
  plain text and the database refuses markup (DECISION_LOG, 2026-08-27).

### Publication, and the opt-in

A service is published by two facts on its catalog row — there is no published
copy of it. A therapist is different: `therapist.is_public` is an **opt-in about a
named human being**, taken with their agreement, which is why
`therapist.publish_profile` is a separate authority from `therapist.update`.
Anybody allowed to fix a misspelt specialty must not thereby be able to publish a
colleague. Nothing falls back to the personnel record: a public therapist shows
`public_display_name`, never `full_name` (DECISION_LOG, 2026-08-21).

A published slug is immutable, and the first-published stamp is what decides
(DECISION_LOG, 2026-08-21).

### An article holds its copy twice

`public_article` carries the draft copy and the published copy in separate
columns, because publication authority cannot be represented once (DECISION_LOG,
2026-08-27): somebody editing tomorrow's draft must not change what a visitor is
reading today. A draft edit is therefore not a modification of the published page.
A testimonial needs no such pair, and that asymmetry is deliberate.

The audit records **that** public prose changed, not the prose (DECISION_LOG,
2026-08-27).

### The anonymous request

`website_request` is the only purgeable table in the schema, and it is erased **in
place** rather than deleted (DECISION_LOG, 2026-08-27) — a lifecycle row survives
so that a colleague reading the inbox is told the content was erased rather than
left to conclude the record was lost. Every inbox read is a discriminated union on
`contentPurged`; there is no wire shape that can express "purged, and here is the
telephone number".

Consent is three columns and a frozen version list, not a boolean. Abuse control
is a rolling duplicate window and a per-submitter throttle, both keyed-hashed and
database-backed, and **nothing about a suppressed duplicate or a refused
submission is observable to the caller** — the public response is the same either
way. The duplicate identity is mobile, service, child age and child sex, and it is
owner-approved and frozen.

Child age is a whole-year triage value with the wide sanity bound `0..120`. It is
**not** an eligibility rule.

The ninety-day erasure is an operator command run against a deployed database with
a `SYSTEM` actor and no session — which is why no permission names it.

### Conversion

Creating a family from a request is the **existing** registration workflow under
the existing `family.create`, with its existing duplicate detection; the request
is linked afterwards. There is no `website_request.convert`, because a second
authority to create a family would be reachable from a screen where the duplicate
check could be forgotten. Both end states of a request are final.

### Permissions

Manager-only: `therapist.publish_profile`, `clinic_profile.read`,
`clinic_profile.update`, `article.publish`, `testimonial.approve`. Held by the
receptionist as well: `article.read`, `article.draft`, `testimonial.read`,
`testimonial.draft`, `website_request.read`, `website_request.process`. Linking a
request additionally demands `family.read`, because it names a family and returns
that family's name.

Answering the clinic's contact form is front-desk work, exactly as the telephone
is; a product where only the manager could return a parent's call would be one
where nobody returns it.

### Persian pages

Public: `/`, `/services`, `/services/{slug}`, `/team`, `/team/{slug}`, `/about`,
`/articles`, `/articles/{slug}`, `/testimonials`, `/contact`, `/privacy`,
`/request` and `/request/received`, plus `/robots.txt` and `/sitemap.xml`. The
public pages are Server Components; interactivity is limited to a small set of
allow-listed, server-independent islands.

Internal: `/website-requests` and `/website-requests/{id}`.

### Database objects

`clinic_public_profile` (one row, created empty), `public_article`,
`public_testimonial`, `website_request`, the `testimonial_status`,
`website_request_contact_time` and `website_request_status` enums, and public
columns with their slug, length and publication-consistency checks on `service`
and `therapist`.

### What Milestone 9 did not deliver

**The internal editorial forms.** The API owns the whole manager write side listed
above, and the six `article.*` / `testimonial.*` permissions are defined,
role-mapped and tested — but no screen in `apps/web` writes an article, a
testimonial, a therapist public profile or the clinic profile. The only Milestone
9 internal UI that exists is the website-request inbox.

A manager therefore cannot publish a word of the public site from the product
today; everything the public pages render reaches the database through the
development seeder or a direct API call. Nothing is unsafe and nothing is broken —
the authority model, the audit rows and the constraints are all in place and all
exercised — but the promise is undelivered rather than deferred by design.

**This gap transfers to Milestone 9.5**, the pre-pilot editorial and media
extension, together with receptionist draft authority over routine public service
and therapist copy, and API-owned media upload and serving. Milestone 9 is not
reopened (DECISION_LOG, 2026-09-08).

### Accepted risks and revisit triggers

1. **All public photography is synthetic development material.** It lives under
   `/public/dev/vala-synthetic` and every visible use is labelled as development
   material rather than real people or spaces. Real owner-approved assets are a
   launch prerequisite, not a code change.
2. **The launch domain is an owner-supplied deployment value.**
   `PUBLIC_SITE_ORIGIN` is required in production, must also appear in
   `WEB_ALLOWED_ORIGINS`, and is deliberately not guessed in source control.
3. **The public team lists therapists only.** Founder, manager and receptionist
   public profiles are explicitly deferred, and no second public-person model
   exists to hold them (DECISION_LOG, 2026-09-08).
4. **Real public copy is owner-supplied.** Where approved wording has not arrived,
   a page states a truthful boundary rather than filling the space.

## Milestone 9.5 contracts — where each one is stated

The shared schemas in `packages/contracts` are the wire contract for every
checkpoint; the notes below say what each checkpoint promises and why. Where a
note and a schema disagree, the schema and its pinning tests win and the note is
the bug.

| Checkpoint                             | Authoritative contract                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A5 — media                             | [docs/M9_5_A5_MEDIA_CONTRACT.md](docs/M9_5_A5_MEDIA_CONTRACT.md) and [Media](#media-milestone-95-checkpoint-a5) below                                         |
| Staff preview of draft media           | [A5 contract §10](docs/M9_5_A5_MEDIA_CONTRACT.md)                                                                                                             |
| A6 — draft and published public copy   | [Draft and published public copy](#draft-and-published-public-copy-milestone-95-checkpoint-a6) below                                                          |
| A7 — spaces, article imagery, notes    | [docs/M9_5_A7_PUBLIC_SPACES_CONTRACT.md](docs/M9_5_A7_PUBLIC_SPACES_CONTRACT.md)                                                                              |
| A8 — the clinic's own public copy      | [The clinic's own public copy](#the-clinics-own-public-copy-milestone-95-checkpoint-a8) below                                                                 |
| A9 — service imagery                   | [docs/M9_5_A9_SERVICE_IMAGERY_CONTRACT.md](docs/M9_5_A9_SERVICE_IMAGERY_CONTRACT.md) and [Service imagery](#service-imagery-milestone-95-checkpoint-a9) below |
| Stabilisation — servability and upload | [Media](#media-milestone-95-checkpoint-a5) below, and DECISION_LOG 2026-09-23                                                                                 |

## Draft and published public copy (Milestone 9.5, checkpoint A6)

A service's public description and a therapist's public display name, title and
biography exist twice on the same row: a **working draft** the front desk may
prepare, and a **published copy** that is what the website says. Every public
read selects the published columns only. Schemas:
`packages/contracts/src/website/public-copy.ts` and
`packages/contracts/src/website/therapist-public-profile.ts`.

- **Drafting** is `service.draft_public_copy` and `therapist.draft_public_profile`
  (receptionist and manager), under `/content/service-copy` and
  `/content/therapist-profiles`. A draft changes no live page.
- **Publishing** is the manager's. A service that becomes reachable through
  `service.update` publishes its prepared description in the same transaction; a
  later change to a live service is promoted explicitly with
  `PATCH /content/service-copy/:id/publication`. For a therapist, the visibility
  opt-in (`therapist.publish_profile`) copies the prepared copy onto the
  published columns — there is no second route.
- **Not draftable:** a service's `name` (it is the public name), a therapist's
  slug, display order and `is_public`. (The legacy `public_photo_path` was
  dropped in the Milestone 9.5 stabilisation; a portrait is a media attachment.)
- `hasUnpublishedChanges` is derived per read, never stored.

The reasoning is in DECISION_LOG, 2026-09-09 (six entries, "Milestone 9.5
checkpoint A6").

## Media (Milestone 9.5, checkpoint A5)

Staff upload ordinary phone photographs; the API stores, sanitises and serves
them. There is no developer file placement and no redeploy in the loop.

**The API owns the bytes, on disk.** Not PostgreSQL — image data in a relational
database bloats every dump, backup and replica for no query anybody makes — and
not object storage, which is a dependency, a credential and a second failure
domain a single-site clinic does not have yet. `MEDIA_STORAGE_DIR` is where they
live, and `MediaStorageService` is the only class in `apps/api` that opens a media
file.

**The uploaded photograph is never written.** It exists in memory for the length
of one request. What is stored is a _master_ — re-encoded, orientation applied to
the pixels, every metadata block discarded — and the responsive renditions
derived from it. An unedited telephone photograph carries the GPS coordinate of
wherever it was taken, so the narrowest way to obey a rule about a category of
data is not to hold the data: no EXIF exists anywhere in this system to leak, and
`image-processing.spec.ts` proves the absence at byte level.

**Three formats, decided from the bytes.** JPEG, PNG and WebP, sniffed from the
magic number and confirmed by the decoder — never from a filename or a
browser-supplied content type. SVG is refused: it is a document with a script
engine attached, and serving one from the clinic's own origin would put
uploader-authored markup on the clinic's own domain. The accepted brand and logo
SVGs stay static in the web tier.

**Two renditions per width, and nothing is ever enlarged.** WebP and JPEG at
every ladder width below the master, plus one at the master's own width, so the
largest rendition is exactly as sharp as the photograph that was uploaded.

**Four conditions decide what a stranger may fetch**, re-evaluated from live rows
on every request: the asset is `ACTIVE`, its attachment is undetached, a manager
published that attachment, and the owner it hangs off is itself public. Every
failure is the same `404 MEDIA_NOT_FOUND`, so nobody can enumerate the clinic's
unpublished photographs one identifier at a time.

**"The owner is public" means exactly "the owner is in its public read".** Each
owner kind's conditions are one SQL fragment in
`apps/api/src/common/public-reachability.ts`, used by the public projection and
the serving predicate alike, so deactivating a therapist or a service,
unpublishing an article or a space, withdrawing a testimonial's approval, or
clearing a content block's heading refuses the owner's photographs on the very
next request. `CLINIC_SPACE`, which no page reads, is never anonymously
servable.

**A retried upload does not duplicate.** Uploading the same bytes again returns
the asset the same colleague already uploaded, keyed on a SHA-256 of the upload
held in the database, so it survives any restart. Image processing runs one
upload at a time per process, which caps peak memory at roughly one worst-case
decode (≈290 MiB) plus 12 MiB per waiting upload (DECISION_LOG, 2026-09-23).

**Publishing is manager-only.** `media.read`, `media.upload` and `media.attach`
are the receptionist's — attaching is drafting, and the request has no field that
could ask for visibility — while `media.publish` covers publishing, unpublishing,
archiving and restoring. Detaching a published attachment is refused; unpublish
first.

**Revocation.** At this origin it is immediate. In any cache the clinic controls
it is bounded by five minutes (`PUBLIC_MEDIA_REVOCATION_WINDOW_SECONDS`), which
is what the `Cache-Control` header states. A copy that has already reached a
browser, a scraper or a search index is bounded by nothing, and nobody may tell a
family otherwise — content identity solves replacement, not revocation.

**Nothing deletes a byte.** Archiving takes a photograph out of circulation
everywhere at once and is reversible; the retention policy is an open owner
decision, and all three media tables refuse `DELETE` and `TRUNCATE` until it
arrives.

## The clinic's own public copy (Milestone 9.5, checkpoint A8)

The clinic's public identity, contact facts and routine home/about copy are data
the manager owns. Changing a heading, a concern prompt, a paragraph or the
picture a shared link unfurls into is a form submission — not a code edit, a
seed or a deployment.

**Two tables, and the split between them is facts against words.**
`clinic_public_profile` is the single always-live row checkpoint A1 created: the
display name, tagline, description, address, city, two telephone numbers,
e-mail, opening-hours line, map pin and two social links.
`clinic_content_entry` is checkpoint A8's addition: twenty-one editorial blocks
of the home and about pages.

**The blocks are fixed slots, not rows anybody creates.** Nine named slots, with
the accepted design's own counts — five concern prompts, three first-session
moments, three about highlights, three about points, three journey steps, and one
block each for the home hero, the first-visit intro, the about intro and the
space note. The migration inserts all twenty-one **empty**, exactly as A1
inserted the profile row empty; `clinic_content_entry_slot_size_chk` and a
`UNIQUE (slot, position)` index cap each slot permanently, and the table refuses
`DELETE` and `TRUNCATE`. Filling a block in is routine content maintenance;
adding one is a design decision and therefore a reviewed migration.

**Editing is publishing.** This surface holds its copy once, unlike an article,
a service description or a public space, each of which holds it twice because a
receptionist may prepare it. There is no draft column, no `is_public` flag and no
publication act here — the whole surface is manager-only under
`clinic_profile.read` and `clinic_profile.update`, and what a manager saves is
what the site says.

**An unwritten block says nothing, and that is one rule with two readers.**
`heading IS NULL` means the block is not on the site: the public projection omits
it, and `LIVE_ATTACHMENT_PREDICATE` refuses any photograph attached to it. A
manager clearing a heading takes the words and the picture down together, at the
origin, on the very next request.

**Photographs are the A5 system used unchanged.** Two new attachment owners:
`CLINIC_CONTENT_ENTRY` names a block and behaves like `PUBLIC_SPACE`, and
`CLINIC_OPEN_GRAPH` is ownerless like `CLINIC_SPACE` because it hangs off the
always-live profile. No second storage path, no bytes in PostgreSQL, and every
A5 invariant intact. **The Open Graph image is photographic, which is why it can
go through this pipeline at all** — SVG is still refused, and the accepted Vala
logo marks stay static in the web tier where a human reviewed them. There is no
staff-manageable logo upload.

**The clinic's public name has one source.** It is
`PublicClinicProfile.displayName`, and nothing else in the API or the shared
contracts holds a second production copy of it.

**Two public reads, one surface, one cache tag.**
`GET /public/clinic-profile` returns the facts and
`GET /public/clinic-content` returns the blocks and the Open Graph photograph;
both are dropped by `PUBLIC_CACHE_TAGS.clinicProfile`, because one manager act
changes both.

**Nothing operational can reach any of it.** `clinic_content_entry` holds no
foreign key at all — no therapist, room, service, appointment, family or child —
so a leak would need a new column and a reviewed migration rather than a widened
`SELECT`.

## Service imagery (Milestone 9.5, checkpoint A9)

A service was the last record in this product with a published page and no way
to illustrate it. `PUBLIC_SERVICE` is the eighth attachment owner and the sixth
that names a row, `media_attachment.service_id` is the whole of the storage
change, and `PublicServiceSummary` gains a nullable `image` that both service
reads carry. No new permission, error code or route came with it.

**The owner gate is three conditions, not a flag, and that is the checkpoint.**
A service is on the website when `is_public` is set AND `status = 'ACTIVE'` AND
it has a slug — what `GET /public/services` has required since Milestone 9
checkpoint A1 — and `LIVE_ATTACHMENT_PREDICATE` now requires exactly the same
three. Deactivating a service writes `status` alone and leaves `is_public`
standing, so a photograph gated on the flag by itself would have outlived the
page it illustrates. The picture and the page now appear and disappear together.

**Two gates, both the manager's.** `media.publish` publishes the attachment;
`service.update` and `service.update_status` decide whether the service is
reachable at all. Closing either revokes the bytes at the origin on the very next
request. A receptionist prepares — `media.upload`, `media.attach` — and can
review a draft under `service.draft_public_copy`, the editorial read they already
hold, which reaches nothing operational and publishes nothing.

**One photograph, not a gallery.** `image` is a single nullable `PublicImage`,
like a testimonial's; the attachment table can hold more and the projection
returns the first by `position`. `null` is the ordinary state, and the internal
service id is a join key that no response carries.

## Environment variables

Never commit a real value for any of these. `.env` and `.env.local` are ignored; the
`.example` files are the reviewed templates.

### `apps/api` — repository-root `.env`

| Variable                 | Required | Purpose                                                                                                   |
| ------------------------ | -------- | --------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`           | yes      | The runtime role (`clinic_app`), never the owner. Never given to `apps/web`.                              |
| `INTERNAL_API_KEY`       | yes      | Shared secret proving a request came from the web server.                                                 |
| `MEDIA_STORAGE_DIR`      | yes      | Directory the API stores uploaded media under.                                                            |
| `API_PORT`               | no       | Defaults to 3001.                                                                                         |
| `NODE_ENV`               | no       | Defaults to `development`.                                                                                |
| `PASSWORD_BLOCKED_TERMS` | no       | Comma-separated clinic terms a password may not contain.                                                  |
| `BACKUP_STATUS_DIR`      | no       | Where the backup collector records the newest off-site copy; read for the manager's stale-backup warning. |

`MEDIA_STORAGE_DIR` has no default, and the reason is not the reason
`INTERNAL_API_KEY` has none. A default here would not be a published credential —
it would be a plausible-looking relative path, and a misconfigured deployment
would start successfully and quietly write families' and colleagues' photographs
into whatever directory the process was launched from, most likely inside a git
working tree. In a deployment it must be a **persistent volume outside the
application directory**, so a redeploy does not take the clinic's photographs
with it. Locally, `.env.example` points it at the gitignored `.media-dev/`.

### `apps/web` — `apps/web/.env.local`

| Variable                | Required        | Purpose                                                       |
| ----------------------- | --------------- | ------------------------------------------------------------- |
| `DEPLOYMENT_MODE`       | yes             | `production` or `non-production`. No default, by design.      |
| `API_BASE_URL`          | yes             | Where NestJS listens.                                         |
| `INTERNAL_API_KEY`      | yes             | Must match the API's value.                                   |
| `SESSION_COOKIE_SECRET` | yes             | HMAC key for the session and CSRF cookie signatures.          |
| `WEB_ALLOWED_ORIGINS`   | yes             | Comma-separated exact origins. All `https` in production.     |
| `PUBLIC_SITE_ORIGIN`    | production only | Owner-approved HTTPS origin for canonical and discovery URLs. |

`DEPLOYMENT_MODE` is independent of `NODE_ENV` on purpose. `next start` forces
`NODE_ENV=production` even when you are testing a production build over plain HTTP on a LAN,
and that is a non-production _deployment_. Tying cookie security to `NODE_ENV` would either
break that case or invite an override flag that eventually gets set on a real server.
Nothing is exposed through `NEXT_PUBLIC_*`, and a boundary check fails the build if a
`NEXT_PUBLIC_` variable ever names a secret.

`PUBLIC_SITE_ORIGIN` must be a bare origin, must also appear in
`WEB_ALLOWED_ORIGINS`, and cannot be localhost in a production deployment. For
local/LAN work it may be omitted; the first allowed origin is then used only as
the preview canonical. The final launch domain is an owner-supplied deployment
value and must not be guessed in source control.

## Bootstrapping the first manager

There is no self-registration and no seeded account. The first manager is created from a
shell on the machine that can already reach the database, by an operator who could read it
anyway. An environment-driven bootstrap would put a plaintext password in the process list
and the deploy manifest; a migration or seed would commit a permanent, shared,
world-readable credential.

```bash
pnpm --filter @clinic/api build
```

```bash
pnpm --filter @clinic/api exec node dist/cli/main.js bootstrap-manager --username <username> --display-name "<display name>"
```

It refuses if **any** user row already exists, and an advisory lock serialises concurrent
attempts so only one can win. The generated password is printed once to stdout — never
through the logger, which in production is a shipping pipeline — and only its Argon2 hash is
stored. A password change is required at first sign-in.

Recovery, for a forgotten manager password. There is no email or SMS channel by design, so
this is the escape hatch:

```bash
pnpm --filter @clinic/api exec node dist/cli/main.js reset-password --username <username>
```

It applies the normal password policy, revokes the target's live sessions, forces a change at
next sign-in, and audits as a `SYSTEM` actor. Both commands accept `--password-stdin` to read
a password from a pipe. **Neither accepts `--password <value>`** — it is refused outright,
because by the time it runs the value is already in shell history and the process list.

## Integration tests

These run against real PostgreSQL. They truncate every table and temporarily disable the
audit triggers between tests, so they need a **disposable** database — and that reset is
the one thing in the suite that runs as the owner. The API under test connects as the
runtime role, exactly as in a deployment, and the harness **refuses to start** if its
connection is a superuser, owns anything, can become the owner, or can create objects.

A throwaway cluster keeps the owner non-superuser, as in production:

```bash
docker exec -i clinic-db psql -U clinic -d postgres -v database=clinic_test -v owner_password=clinic_owner_test_only -v runtime_password=clinic_app_dev_only -f - < apps/api/prisma/provision-roles.sql
```

```bash
DATABASE_URL='postgresql://clinic_owner:clinic_owner_test_only@localhost:5433/clinic_test?schema=public' pnpm --filter @clinic/api exec prisma migrate deploy
```

```bash
DATABASE_URL='postgresql://clinic_app:clinic_app_dev_only@localhost:5433/clinic_test?schema=public' TEST_OWNER_DATABASE_URL='postgresql://clinic_owner:clinic_owner_test_only@localhost:5433/clinic_test?schema=public' INTERNAL_API_KEY=<32+ synthetic characters> MEDIA_STORAGE_DIR=<a scratch directory outside the repository> pnpm test:int
```

An existing `clinic_test` created by `clinic` keeps `clinic` as its owner; drop and
re-provision it, or pass the `clinic` URL as `TEST_OWNER_DATABASE_URL`.
`TEST_OWNER_DATABASE_URL` must name the same server and database as `DATABASE_URL` and a
different role. Nothing in `src/` reads it.

`INTERNAL_API_KEY` and `MEDIA_STORAGE_DIR` are both required: the operator CLI
suites build a real NestJS context, which validates the whole API environment
and refuses to start without either. The HTTP suites ignore both — the harness
supplies its own synthetic key and a per-process temporary media root — so
nothing a test writes lands in the directory you name.

The harness accepts only a database whose name ends in `_test` or `_ci`. That is an
allowlist, not a blocklist: excluding `clinic_dev` by name would protect one database and let
a stray `DATABASE_URL` pointing at a pilot instance straight through.

`clinic_dev` is yours. Nothing in the test suite writes to it.

## Product priorities

This is a pediatric rehabilitation clinic in Iran. Security and accounting correctness are
non-negotiable; within that, implementation decisions also prioritise real clinic usability.
Internal surfaces aim at fast low-friction workflows, readable Persian RTL layouts,
responsive and accessible controls, clear error recovery, correct Iranian date, time, number
and toman presentation, and predictable loading, empty, success and error states. Internal
authentication and administration pages are **not** optimised for search engines and stay
`noindex`.

The Milestone 1 pages here are deliberately minimal and are **not** the model for that. They
exist to prove an authentication and audit boundary and are reached rarely. See
[docs/DECISION_LOG.md](docs/DECISION_LOG.md) for the full principles, which govern Milestone 2
onward.
