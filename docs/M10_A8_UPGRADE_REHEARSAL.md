# Milestone 10, checkpoint A8 — upgrade and rollback rehearsal

After go-live every fix reaches the clinic through an upgrade. This is the record of
rehearsing the procedure that `docs/DEPLOYMENT_RUNBOOK.md` now gives for it (steps
17 and 18) on a disposable server, with synthetic data only. The rehearsal ran on
2026-10-02 (01:19–01:39 Tehran; the logs below are in UTC).

## 1. The server, and what differed from production

A new WSL distribution, `clinic-upgrade-rehearsal` (Ubuntu 24.04, systemd), installed
by the runbook's steps 1–16 in the new release-directory layout. **`clinic-staging`
was not stopped, restarted, upgraded or entered**: the owner is touring it.

WSL distributions share one network namespace: the new one saw staging's listeners
(80, 443, 3000, 3001, 5432) but kept its own cgroups. So, and only so:

| Runbook          | Rehearsal                                                                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ports            | PostgreSQL 5442, API 3101, web 3100, nginx 8080/8443 (every command's port substituted; the API port through `API_PORT`, the web's in its unit and the nginx template)                                                                      |
| package installs | `/usr/sbin/policy-rc.d` refused every service start during `apt-get`, so nothing could take a port staging uses; services were started by hand after their port was set. Removed at the end of step 16                                      |
| step 1           | no `ufw` (it would rewrite the firewall shared with staging), no SSH, no swap file (WSL has its own); `[time] useWindowsTimezone=false`                                                                                                     |
| step 7           | `DB=clinic_demo`, public origin `https://clinic-rehearsal.test:8443`, `https://localhost:8443` also allowed                                                                                                                                 |
| step 10          | after the first manager, the old release's own synthetic clinic (`dist/dev/main.js --confirm --weeks 3 --families 8 --therapists 3`) and photo seeder (`scripts/backup/drill-seed.mjs`): 8 families, 66 charges, 10 payments, 3 photographs |
| step 12          | self-signed certificate for `localhost`; no HSTS; `staging-noindex.conf` included                                                                                                                                                           |
| step 13          | a stand-in owner key **with a passphrase**; the passphrase fed on standard input where an operator would type it                                                                                                                            |
| step 15          | the collector was not repeated (A7 rehearsed it; nothing in A8 touches it)                                                                                                                                                                  |
| `systemd`        | `system.slice` pinned to two CPUs (`AllowedCPUs=0-1`) to stand in for 2 vCPU                                                                                                                                                                |
| `scp`            | a copy of the `git archive` from this computer                                                                                                                                                                                              |

**Releases.** `52efe4e` (2026-09-25, before the A10 migration) as the old release;
`23f2e94` (M10-B12, which brings `20260930090000_m95_a10_erase_media_description` and
the redirect fix); `fbe242d` (this checkpoint's own commit with the fixes below).
`52efe4e` predates `scripts/ops`, so its API and web units and the nginx template were
taken from this checkpoint's tree. The A8 restore wrapper did not exist in `52efe4e` or
`23f2e94`; as the runbook allows for a release older than A8, the rehearsal used this
checkpoint's copy (it always restores with the live release's own `restore.sh`).

## 2. How it was run

Each phase was a script **generated from the runbook itself**: the `bash` blocks of
steps 17 and 18, extracted in order, with only the substitutions of §1, executed one
by one, each printed before it ran and stopped at the first non-zero exit. Rehearsal-only
lines (entering a family through the web, state checks) are marked as such in the logs.
Between blocks every phase printed the live link, each service's working directory
(`/proc/<pid>/cwd`, so the code actually running is shown, not assumed) and counts of
families, payments, charges, media and audit rows.

**Downtime** was measured from outside: a prober requesting `https://localhost:8443/`
through nginx every ~0.3 s for the whole phase. WSL's wall clock stepped backwards by
about six seconds twice during phase P2 (`systemd-journald: Time jumped backwards`), so
from P3 on every timing used the monotonic `/proc/uptime`; P1 and P2's figures are
superseded by their repeats.

## 3. Results

| Phase | Procedure (runbook)                              | From → to                      | Site down                           | Result                                                                                                                                                                                                                                                         |
| ----- | ------------------------------------------------ | ------------------------------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0    | install, steps 1–16                              | — → `52efe4e`                  | —                                   | `SITE VERIFIED` (14 public pages, 12 image renditions, sign-in, dashboard, sign-out); backup and nightly jobs ran                                                                                                                                              |
| P1    | upgrade with migrations, 17.2–17.6               | `52efe4e` → `23f2e94`          | 45 s (wall clock)                   | trial restore `RESTORE VERIFIED`; `Applying migration 20260930090000_m95_a10_erase_media_description`; `SITE VERIFIED`; sign-in answers `Location: /dashboard` with no nginx rewriting. Then a family, "A8 entered after the upgrade", entered through the web |
| P2    | restore rollback, 18.2                           | `23f2e94` → `52efe4e`          | (clock stepped; see P2b)            | `RESTORE VERIFIED`, run-jobs four `SUCCEEDED`, `SITE VERIFIED`; the family is gone from the live system; the set-aside database's audit list shows its `family.created`. **Found gap 1** (§4): the next backup failed                                          |
| P3    | upgrade with migrations, again                   | `52efe4e` → `23f2e94`          | 41 s                                | after the P2 restore's media modes were corrected by hand (gap 1); all checks pass                                                                                                                                                                             |
| P2b   | restore rollback, again, with the fixes          | `23f2e94` → `52efe4e`          | **7.5 s** (prober 6.3 s)            | a family entered on `23f2e94` first; `RESTORE VERIFIED`; media root `drwxr-s--- clinic-api:clinic-api`; the backup straight after `BACKUP COMPLETE`; `SITE VERIFIED`; live database: no A8 family; set-aside database: "A8 entered after the second upgrade"   |
| P3c   | upgrade with migrations, third time              | `52efe4e` → `23f2e94`          | **39 s** (prober 38.0 s)            | all checks pass                                                                                                                                                                                                                                                |
| P4    | upgrade, **code** (web built while closed)       | `23f2e94` → `fbe242d`          | **33 s** (prober 31.9 s)            | `SITE VERIFIED`; a family "A8 entered on fbe242d" entered                                                                                                                                                                                                      |
| P5    | **code rollback**, 18.1                          | `fbe242d` → `23f2e94`          | **2.2 s** (prober: 5 failed probes) | `SITE VERIFIED`; both services run from `/srv/clinic-releases/23f2e94`; the family entered on `fbe242d` is still there                                                                                                                                         |
| P6    | upgrade, **web only** (web built before closing) | `23f2e94` → `fbe242d`          | **2.4 s** (prober: 6 failed probes) | the rolled-back `fbe242d` directory removed and rebuilt clean, as 17.2 says; `SITE VERIFIED`                                                                                                                                                                   |
| P7    | conversion of an A7-layout install, 18.4         | `/srv/clinic` directory → link | **1.3 s** (prober: 1 failed probe)  | `fbe242d` first installed the A7 way (a directory, `SITE VERIFIED`), then converted; `SITE VERIFIED` again, services in `/srv/clinic-releases/fbe242d`                                                                                                         |

**Where the downtime goes** (P3c, migrations): backup 0.4 s, its trial restore 4.5 s,
migration 1.6 s, API start 1.1 s, **web build 30.3 s**, web start 1.2 s. Code (P4): API
start 1.1 s, web build 30.9 s, web start 1.2 s. Restore rollback (P2b): restore 4.5 s,
run-jobs 0.7 s, both services 2.2 s. Outside the downtime: preparing a release (extract,
install from the warm package store, build the API) 13–15 s; the web-only build 31 s.

**At a larger size.** The rehearsal's backups were 3 MB. Signing and encrypting 430 MB
of incompressible photographs (the README's first-year estimate is 450 MB) took 12.2 s
on the same two cores, decrypting 1.6 s and hashing every file 0.4 s; so at the first
year's size the backup and its proof add roughly half a minute. The runbook says "plan
on two minutes" for an upgrade with migrations and for a restore rollback.

**Disk.** The pnpm store 772 MB; each further release 0.3–0.5 GB beyond it (`du`
counting shared files once).

**Not exercised:** an operator typing the passphrase at a real terminal (fed on
standard input; the same `read` either way); a migration that fails (the runbook sends
it to 18.2, rehearsed); a release that changes a unit, nginx or an environment file
(17.5); a real 2 vCPU server, whose web build may be slower than two pinned desktop
cores; `systemctl --failed` lists two WSL-only units (`getty@tty1`,
`systemd-binfmt`) that a VPS does not have.

## 4. Gaps found, all fixed

1. **The first backup after any restore failed.** `restore.sh` copied the media with the
   archive's own modes (`0700`/`0600`, from the backup's `umask 077`); the backup user
   reads the media through the API's group, so it found "21 media file(s) … missing"
   and wrote nothing. A README restore onto a new server had the same defect; the
   drill could not show it, because it runs everything as one user. Fixed:
   `restore.sh` gives the media the API's modes (`u=rwX,g=rX,o=`), `verify.sh` now
   refuses media its group cannot read, the A8 wrapper corrects them for a live release
   older than the fix, and a restore rollback takes a backup at once (18.2).
2. The runbook read the backup's result with `journalctl -n 1`, which shows systemd's
   "Finished" line, not `BACKUP COMPLETE`. The pre-upgrade backup's name is now taken
   from its own `BACKUP COMPLETE` line (empty if it failed).
3. Re-upgrading to a release that was rolled back met its old directory. 17.2 now says
   to remove a failed or rolled-back release directory and build it clean.
4. `52efe4e` (and every release before M10-B12) cannot sign anybody in behind the
   nginx site without the withdrawn `proxy_redirect`; its own `verify-site.mjs`
   predates the check that would say so. 18.1 now names B12 as the oldest release a
   rollback may reach; production starts after it.
5. (rehearsal only) `pg_createcluster` picked 5433 because staging held 5432 in the
   shared namespace: on a server of its own the runbook's 5432 stands.

## 5. B12 folded in

- No `proxy_redirect` in `scripts/ops/nginx/clinic.conf` (B12) or in any runbook
  instruction; every rehearsal nginx site was generated from that template, and every
  sign-in answered a path (`Location: /dashboard`). The A7 record (§4 item 22, §5 B1)
  and the A7 decision are marked superseded; the runbook says the directive must not
  come back (17.5).
- `docs/STAGING_OWNER_NOTES.md`: the collector cleanup now names
  `(Join-Path $env:ProgramData 'ClinicBackupCollector')` and `'C:\ClinicBackups'`, each
  listed before it is removed; A7 §6's `C:ClinicBackups` corrected.
- B12's step 4 (`pnpm` run in the release directory on the server) is in steps 6 and
  17.2.

## 6. Removal

`wsl --unregister clinic-upgrade-rehearsal`: "The operation completed successfully";
the distribution is gone from `wsl --list`, its folder `E:\wsl\clinic-upgrade-rehearsal`
no longer exists, and no process referring to it remains. `clinic-staging` stayed
`Running` throughout and was never addressed; the owner's `Ubuntu` was not started.

## 7. For Agent B

- **The web build is the downtime.** 31 of the 33–39 seconds of a code or migration
  upgrade are `next build`, which must run while the site is closed because it
  prerenders the public pages from the new API. If the public pages could be generated
  on first request instead of at build time (the 15-minute revalidation already exists),
  every release could build its web before closing, and downtime would be a restart
  (about 2 s, as P6 shows). Optional; not needed for go-live.
- B2 (a refused page answers 200) is unchanged and was not touched.
