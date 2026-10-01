# Milestone 10, checkpoint A7 — staging rehearsal

The production install rehearsed on a disposable server before the real one is
bought. The runbook it produced and corrected is `docs/DEPLOYMENT_RUNBOOK.md`;
the owner's notes are `docs/STAGING_OWNER_NOTES.md`. Synthetic data only.

## 1. What was done

- **The server.** A new WSL distribution, `clinic-staging`: Ubuntu 24.04.5 LTS
  with systemd, on `E:\wsl\clinic-staging`. The owner's own `Ubuntu`
  distribution was not started or changed.
- **Pass 1** (2026-10-01): installed by hand while the runbook was written.
  Then removed with the documented command, `wsl --unregister clinic-staging`,
  which took the distribution, its 4.9 GB disk image and its folder, and left the
  other distributions untouched.
- **Pass 2**: a fresh distribution, installed by executing the runbook's own
  `bash` blocks, extracted from the page in order, with only the substitutions its
  Appendix A lists (staging database name and origins, port 2222, self-signed
  certificate, a stand-in owner key, a throwaway collector key). Skipped, and said
  so in the log: the operator-side `scp`, Let's Encrypt (needs a real domain), and
  the interactive site check (run separately). Pass 2 stopped once, at a gap
  (§4, 21); the runbook was fixed and the run resumed from that step.
- **Data.** The practice clinic (README, The practice clinic; every
  reconciliation check `ok`), then sample public content through the real API as
  a manager: the clinic profile and all 21 editorial slots, 3 services, 3
  therapist profiles, 3 articles, 2 testimonials, 3 spaces, 22 abstract
  photographs (no text, no people). Every text says «نمونه» and invents no
  clinic fact; telephone and address are labelled placeholders. The staging site
  is not indexable (`robots.txt` disallows everything; every response carries
  `X-Robots-Tag: noindex, nofollow, noarchive`) and is reachable only from the
  computer it runs on.

## 2. Smoke test

All through nginx and HTTPS, as a browser would. The built-in browser pane
refuses `localhost`, so the browser's own requests were made by scripts: the
same pages, the same route handlers, the same cookies and CSRF tokens.

| Check                                                                 | Result                                                                                                                  |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `GET /health/ready`                                                   | `{"status":"ok","checks":{"database":"ok","media":"ok"}}`                                                               |
| Every public page by name (12, incl. one service, therapist, article) | 200, each carrying «نمونه»; `/no-such-page` 404                                                                         |
| `robots.txt`, `sitemap.xml`                                           | `Disallow: /`; 18 URLs on `https://clinic-staging.test`; both `noindex`                                                 |
| `verify-site.mjs` (README, Restoring, step 8)                         | `SITE VERIFIED`: public pages, 173 published renditions served, manager sign-in, dashboard, sign-out                    |
| Manager sign-in                                                       | 303 → `/dashboard` (after the §4, 22 fix; before it, `https://localhost:3000/dashboard`)                                |
| Receptionist first sign-in                                            | 303 → `/change-password`; change → `/dashboard`; dashboard, families, diary 200                                         |
| Receptionist on manager pages                                         | `/staff` 307 → `/dashboard`; reports and settlements stream a redirect to `/dashboard`, no money in the page (§5, B2)   |
| Photo upload and publish (12 MP, 5.95 MiB)                            | upload 201 in 6.8 s (12 renditions), draft-attach 201, publish 303; `/about` shows it; rendition served as `image/webp` |
| One backup                                                            | `BACKUP COMPLETE`, 242 then 268 media files checked by hash, 3.4 then 13.6 MiB archive                                  |
| One nightly-jobs run                                                  | four `SUCCEEDED` lines                                                                                                  |
| Collector, server side (throwaway key)                                | `list`, `get`, `ack` answered; a shell and a path name refused; cannot read media or write backups                      |
| Timers                                                                | backup 02:30 and jobs 04:15 Tehran (UTC 23:00 and 00:45 + random delay)                                                 |
| Firewall                                                              | from outside the server: 443 answers, 3000 and 3001 do not                                                              |

## 3. Resources

Measured per systemd unit from its cgroup, every 0.25 s, with every service
pinned to **2 CPUs** (`AllowedCPUs=0-1` on `system.slice`) to stand in for
2 vCPU. "Own" is anonymous memory, what the processes themselves hold; "total"
adds page cache, which the kernel gives back under pressure. Whole-system figures
include WSL's own services and are therefore slightly high for a VPS.

| Moment                                             | PostgreSQL own/total | API own/total | Web own/total     | nginx | Whole system | CPU                              |
| -------------------------------------------------- | -------------------- | ------------- | ----------------- | ----- | ------------ | -------------------------------- |
| Idle, API freshly started                          | 5 / 49 MiB           | 116 / 146     | 86 / 91           | 14    | 0.9 GiB      | ~0                               |
| Idle, after the API had processed 22 photographs   | 26 / 71              | 417 / 499     | 86 / 91           | 14    | 1.2 GiB      | ~0                               |
| Two 12 MP uploads (5.95 MiB each), with publishing | 9 / 60               | **665** / 686 | 189 / 199         | 32    | **1.75 GiB** | API 7 CPU-s per photo (≈ 1 core) |
| Backup (13.6 MiB archive)                          | 15 / 66              | 646 (held)    | 168               | 14    | 1.5 GiB      | backup 0.5 CPU-s, < 10 MiB       |
| Nightly jobs                                       | 9 / 61               | 511 (held)    | 168               | 14    | 1.5 GiB      | jobs 1.1 CPU-s, 73 MiB           |
| Web build, Node seeing 2 CPUs (web stopped)        |                      | (held)        | build **1.6 GiB** |       | **2.6 GiB**  | 30 s                             |
| Web build, Node seeing 24 CPUs (23 workers)        |                      |               | build 3.5 GiB     |       | 4.5 GiB      | 45 s                             |

The last row is this computer, not the server: Next.js sizes its build workers
from the host's CPU count, so it does not apply to a 2 vCPU VPS, and it is the
reason the build is measured both ways.

**Disk** (pass 2, with the practice clinic and sample content): 4.2 GB used in
all — Ubuntu, PostgreSQL, Node, nginx and the application. Of that: the release
with its dependencies 0.9 GB, the build user's package store 1.2 GB (shared by
hard links with the release), the web build 60 MB, the database 14 MB, the media
14 MB (268 files), the journal 310 MB (capped at 1 GB). The two synthetic 12 MP
photographs added about 5 MB each to a backup — noise compresses badly, so this
is an upper bound against README's 2.4 MB for a real telephone photograph.

### Recommendation

- **RAM: 4 GB — confirmed**, with a 2 GB swap file (runbook, step 1). Normal
  use peaks under 2 GiB. The tightest moment is a web build on the server
  (2.6 GiB system-wide), which happens only at install and upgrade. The API keeps
  the memory it used for photographs (116 → 665 MiB) rather than returning it.
  **Revisit if** its resident memory passes 1.5 GiB in production: then cap
  libvips' cache or the allocator's arenas, measured.
- **CPU: 2 vCPU — confirmed.** Only photograph processing is CPU-bound (one core
  for about 7 s per 12 MP photo); everything else is idle in comparison.
- **Disk: 60 GB rather than 40.** At README's growth, the first year ends
  near 23 GB: about 5.5 GB for the system, release and package store, up to
  14 GB of server backups (30 nights × ~450 MB), under 1 GB of media and
  database, 1 GB of journal, room for one backup's plaintext staging copy and a
  second release during an upgrade. 40 GB holds year one but not year two's
  backups; 60 GB holds both. **Revisit** at twelve months against the real
  backup size (`ls -l /var/backups/clinic`).

## 4. Runbook gaps found, all fixed

The README held the database-role, backup, jobs and logging steps; nothing
installed a server end to end. `docs/DEPLOYMENT_RUNBOOK.md` is new. Found on the
way, each fixed in the runbook, a unit, the nginx template or the README:

1. No API or web systemd unit — `scripts/ops/systemd/clinic-api.service`,
   `clinic-web.service` (least privilege, read-only system, write access to
   one directory each).
2. No reverse proxy or TLS — `scripts/ops/nginx/clinic.conf`, plus
   `staging-noindex.conf` for a staging host.
3. nginx's default 1 MB body limit would refuse every real photograph (the API
   accepts 12 MiB) — `client_max_body_size 13m`.
4. The API listens on every interface (`main.ts` takes no host) — the firewall
   step keeps 3001 private; Next.js is bound to 127.0.0.1.
5. The web tier takes the first `X-Forwarded-For` address as the client's — the
   proxy sets the header rather than appending to a client-supplied one.
6. `next build` rewrites `next-env.d.ts` in the source tree — the build runs as
   the code's owner and hands `.next` to the web user.
7. The web build needs the API running (the public pages are prerendered from
   it) and the web's secrets — ordering, and `systemd-run` reading the root-only
   environment file.
8. No production pattern for secrets, migrations or operator commands — four
   environment files in `/etc/clinic`, each readable by root and one user; the
   owner's URL only in the migration step; `systemd-run` so no secret passes
   through a shell or an argument.
9. `next start` exits 143 on a normal stop, recorded as a failure —
   `SuccessExitStatus=143`.
10. Terminal colour codes in the journal — `NO_COLOR=1`.
11. Ubuntu's rsyslog kept a second copy of every log line in `/var/log/syslog`
    (2,652 lines within the hour) — `ForwardToSyslog=no`.
12. nginx's default access log records client addresses and query strings, and a
    family search is a query string — a log format with neither.
13. Ubuntu 24.04's nginx (1.24) does not know `http2 on;`.
14. README's signing-key and first-backup commands did not say which user or
    environment — `sudo -u clinic-backup`, and the first backup run through its
    own unit.
15. The collector login owned its home and could have replaced its own
    restricted `authorized_keys` — home, `.ssh` and the key file are now root's.
16. Next.js telemetry was on — `NEXT_TELEMETRY_DISABLED=1`.
17. The backup URL must not carry `?schema=public` (it is libpq's, not Prisma's).
18. Nothing listed the hosts the install downloads from — step 0 checks them
    before the server is paid for.
19. WSL resets the time zone to Windows' at every start, and stops an idle
    distribution after about a minute — Appendix A and the owner's notes.
20. (pass 2) `sshd -t` fails on a server nobody has reached over SSH, and inside
    an `&&` chain silently skipped the restart — the runtime directory is created
    first.
21. (pass 2) The readiness checks ran before the services had started — they now
    wait up to 30 s.
22. (pass 2 smoke test) Every route-handler redirect pointed at
    `https://<host>:3000/...` behind the proxy — see §5, B1. Fixed in nginx
    (`X-Forwarded-Port`, `proxy_redirect`); the web-tier fix is Agent B's.
23. `verify-site.mjs` followed only the redirect's path and passed despite 22 — it
    now fails a sign-in or sign-out that leaves the site's origin (shown failing
    without the nginx fix and passing with it). Not re-run in the restore drill,
    whose web URL and redirects share `http://localhost:<port>`.
24. (measurement) No swap, and the web build is the largest memory moment — a
    2 GB swap file in step 1.

## 5. For Agent B (web tier)

**B1 — redirects carry Next.js's own port behind a proxy. Needed before go-live.**
Route handlers build redirect targets from `request.url`, which behind a reverse
proxy is `https://<host>:3000/...` whatever `X-Forwarded-Host`/`-Proto`/`-Port`
say (measured with all four combinations). A browser following it fails: sign-in,
sign-out, the password change and every form post. Places:
`server/security-headers.ts:27` (`secureRedirect`), `server/handler-support.ts:139`,
`server/notices.ts:60`, `app/api/settlement/view/route.ts:39`,
`app/api/settlement/close/route.ts:36`, `app/api/reports/filter/route.ts:55,61,99,105`,
`app/api/families/status/route.ts:57`. Suggested: a relative `Location` (a path
the handler chose, as today), which every browser resolves against the page's
own origin — no header is trusted and nothing can steer it. Until then nginx
rewrites the header (`proxy_redirect` in `scripts/ops/nginx/clinic.conf`), and
`verify-site.mjs` fails if it ever comes back. `proxy.ts:76` (`nextUrl.origin`)
is correct behind nginx once `X-Forwarded-Port` is sent.

**B2 — a refused page answers 200 (observation, low).** For a receptionist, the
manager-only reports and settlements pages answer HTTP 200 with a streamed
`NEXT_REDIRECT` to `/dashboard` (the permission check runs after the layout has
started streaming); `/staff` answers 307. No money reaches the page and NestJS
refuses the data anyway. Optional: check before streaming, so the status says
what happened.

## 6. Owner access, phone and collector

- **Addresses:** `https://localhost/` and `https://localhost/login` on this
  computer; the certificate warning is expected (owner notes).
- **Phone:** possible on the home Wi-Fi only, with two Windows changes the owner
  makes as Administrator and removes afterwards (a port proxy on the Wi-Fi
  address, port 443, and a firewall rule limited to the local subnet). Staging
  is prepared for it (certificate and allowed origin include `192.168.2.46`);
  the Windows side was not made and is untested. No router change and no
  internet exposure.
- **Collector:** see the checkpoint report.

## 7. Decisions and assumptions

- **Ubuntu 24.04 LTS** for the VPS (no version was recorded). Alternative:
  26.04 LTS. Reason: offered by every provider today, supported to 2029
  (2034 with Pro), PGDG and NodeSource both build for it. Revisit if the chosen
  provider offers 26.04 and the runbook is re-rehearsed on it.
- **Staging runs in production mode** (`NODE_ENV=production`,
  `DEPLOYMENT_MODE=production`, `__Host-` cookies, HTTPS) so it rehearses what the
  server will run. Its public origin is `https://clinic-staging.test` — `.test`
  never resolves on the internet, so canonical links and the sitemap cannot
  point at a real site — and the browser uses `https://localhost`, also allowed.
- **Staging database `clinic_demo`**: the practice clinic refuses any database
  not named as disposable, so production's `clinic` can never receive it.
- **The owner's backup key is a stand-in** made for staging; the real one is the
  owner's to make on his own computer.
- **TLS on the real server**: Let's Encrypt via certbot, standalone with nginx
  stopped for the few seconds of issuance and renewal (runbook, step 12). Not
  rehearsed — it needs the real domain pointing at the server.
