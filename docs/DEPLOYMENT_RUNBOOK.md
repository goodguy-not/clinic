# Deployment runbook — one Linux server

Milestone 10, checkpoints A7 (install) and A8 (upgrade and rollback). How to
install the clinic platform on a fresh Ubuntu server, step by step, as a new
operator would, and how every later release reaches it. The README keeps the
**why** of each part (database roles, backups, jobs, logging); this page is the
**order** and the exact commands.

**Rehearsed** end to end on a disposable Ubuntu 24.04 server (a WSL distribution,
[Appendix A](#appendix-a--the-staging-rehearsal-on-wsl)) on 2026-10-01: installed
once while this page was written, wiped, and installed again by following only
this page. Two steps could not be rehearsed there and say so: the Let's Encrypt
certificate (needs a real domain) and the collector on the real clinic computer.

Every command below runs on the server as a user with `sudo`, unless it says
otherwise. `<SITE_HOST>` is the owner-approved host name (for example
`clinic.example.ir`); nothing here guesses it.

## 0. Before you start

| You need                                                                                                                         | From                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| A server: Ubuntu **24.04 LTS**, 2 vCPU, 4 GB RAM, 60 GB disk (rehearsal sizing), a public IPv4, root or sudo over SSH with a key | the hosting account (owner)                                                 |
| The site's host name, with an `A` record pointing at the server                                                                  | the owner (DNS)                                                             |
| An e-mail address for certificate expiry notices                                                                                 | the owner                                                                   |
| The owner's **public** backup key, `clinic-backup-public.asc`                                                                    | the owner, made on his own computer (README, Setting up the server, step 2) |
| Clinic terms a password may not contain (optional)                                                                               | the owner (`PASSWORD_BLOCKED_TERMS`)                                        |
| A copy of the repository at the release commit                                                                                   | the operator's computer                                                     |

**Outbound access.** The install downloads from `archive.ubuntu.com`,
`apt.postgresql.org`, `deb.nodesource.com`, `registry.npmjs.org`,
`binaries.prisma.sh` (Prisma's engines, during `pnpm install`) and, for the
certificate, `acme-v02.api.letsencrypt.org`. Check from the server, before
anything else, that each answers — a provider that blocks one of them must be
known before the server is paid for:

```bash
for u in https://apt.postgresql.org https://deb.nodesource.com https://registry.npmjs.org https://binaries.prisma.sh https://acme-v02.api.letsencrypt.org/directory; do curl -s -o /dev/null -w "%{http_code} $u\n" --max-time 10 "$u"; done
```

Any status other than `000` means the host is reachable.

## 1. Base system

```bash
sudo apt-get update && sudo apt-get -y full-upgrade
```

```bash
sudo apt-get install -y ca-certificates curl gnupg ufw nginx openssh-server unattended-upgrades
```

The server runs in **UTC**; the clinic's business time is Asia/Tehran and is
decided in SQL, never by the server clock (README, Checks):

```bash
sudo timedatectl set-timezone Etc/UTC
```

**Swap.** Building the web (step 11) is the server's largest memory moment —
about 1.6 GiB on 2 vCPU, on top of the running API and PostgreSQL (rehearsal
measurement). A 2 GB swap file keeps a 4 GB server from killing a build or an
upload; skip it if `swapon --show` already lists one. (Not rehearsed: WSL brings
its own swap.)

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**Firewall.** Only SSH and the web. The API listens on every interface
(`apps/api/src/main.ts` takes no host), so this is what keeps port 3001 private:

```bash
sudo ufw default deny incoming && sudo ufw default allow outgoing && sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw --force enable
```

**SSH: keys only** — after checking, in a second terminal, that your key signs
you in:

```bash
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' | sudo tee /etc/ssh/sshd_config.d/10-clinic.conf && sudo install -d -m 0755 /run/sshd && sudo sshd -t && sudo systemctl restart ssh
```

`sshd -t` checks the configuration before the restart, so a mistake cannot lock
you out. On Ubuntu 24.04 SSH starts on demand, and on a server nobody has yet
reached over SSH (a provider's web console) its runtime directory does not exist
and the check fails with `Missing privilege separation directory: /run/sshd` —
hence the `install -d` first.

## 2. PostgreSQL 17

From the PostgreSQL project's own repository (Ubuntu 24.04 ships 16):

```bash
sudo apt-get install -y postgresql-common && sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y && sudo apt-get install -y postgresql-17
```

Check it listens on `localhost` only and runs in UTC — the defaults:

```bash
sudo -u postgres psql -Atc "show server_version; show listen_addresses; show timezone"
```

PostgreSQL's own log (`/var/log/postgresql/`) is rotated by the package's
logrotate rule; nothing to add.

## 3. Node.js 24 and pnpm

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource_setup.sh && sudo bash /tmp/nodesource_setup.sh && sudo apt-get install -y nodejs
```

```bash
sudo corepack enable && node --version
```

`pnpm` itself is fetched by corepack on first use, at the version the
repository pins (`packageManager` in `package.json`).

## 4. Users and directories

| User               | Runs                                                          | Can write                              |
| ------------------ | ------------------------------------------------------------- | -------------------------------------- |
| `clinic-build`     | dependency install and builds; owns the code                  | `/srv/clinic-releases`                 |
| `clinic-api`       | the API and the nightly jobs                                  | the media directory                    |
| `clinic-web`       | Next.js                                                       | its own build output, `apps/web/.next` |
| `clinic-backup`    | the backup; member of `clinic-api` (reads the media)          | the backup directory, its signing key  |
| `clinic-collector` | the clinic computer's SSH login (forced command)              | the off-site status file               |

No service can modify its own code: the code belongs to `clinic-build`.

```bash
sudo useradd --system --user-group --home-dir /var/lib/clinic-build --create-home --shell /usr/sbin/nologin clinic-build
sudo useradd --system --user-group --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin clinic-api
sudo useradd --system --user-group --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin clinic-web
sudo useradd --system --user-group --groups clinic-api --home-dir /var/lib/clinic-backup --create-home --shell /usr/sbin/nologin clinic-backup
sudo groupadd --system clinic-collect
sudo useradd --system --gid clinic-collect --home-dir /var/lib/clinic-collector --create-home --shell /bin/sh clinic-collector
```

`clinic-collector` needs a real shell because SSH runs its forced command
through it; it has no password and can run nothing else.

```bash
sudo install -d -o clinic-build -g clinic-build -m 0755 /srv/clinic-releases
sudo install -d -o root -g root -m 0755 /etc/clinic /var/lib/clinic
sudo install -d -o clinic-api -g clinic-api -m 2750 /var/lib/clinic/media
sudo install -d -o clinic-collector -g clinic-api -m 2750 /var/lib/clinic/backup-status
sudo install -d -o clinic-backup -g clinic-collect -m 2750 /var/backups/clinic
sudo install -d -o clinic-backup -g clinic-backup -m 0700 /var/lib/clinic-backup/signing-gnupg
```

The media directory is **outside** the code directory, so replacing a release
never touches the clinic's photographs (README, Environment variables).

**Releases.** Each release gets its own directory, `/srv/clinic-releases/<commit>`,
and `/srv/clinic` is a link to the live one. Everything else — the units, the
collector's forced command, every command on this page — names `/srv/clinic`. An
upgrade builds the next release beside the live one and moves the link; the
previous release stays built, so going back is moving the link back (steps 17
and 18). The link belongs to root: the build user cannot change which release runs.

## 5. The release

On the operator's computer, from the repository at the release commit — the
server needs no GitHub access and no credentials:

```bash
git archive --format=tar.gz -o clinic-release.tar.gz <commit>
```

```bash
scp clinic-release.tar.gz <you>@<server>:/tmp/
```

On the server, into a directory named after the commit, then link it:

```bash
REL=/srv/clinic-releases/<commit>
```

```bash
sudo -u clinic-build install -d $REL && sudo -u clinic-build tar -xzf /tmp/clinic-release.tar.gz -C $REL && sudo ln -sfn $REL /srv/clinic && readlink /srv/clinic
```

## 6. Install and build the API

```bash
cd /srv/clinic && sudo -u clinic-build -H env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile
```

```bash
cd /srv/clinic && sudo -u clinic-build -H pnpm build:contracts && sudo -u clinic-build -H pnpm --filter @clinic/api build
```

Run `pnpm` **in the release directory on the server** (`cd` first, as
above), never in a checkout reached from another system: on staging, `pnpm`
started from the Windows checkout through WSL failed with `EPERM: operation not
permitted, futime` (M10-B12).

The web is built later (step 11): it prerenders the public pages **from the
running API**.

## 7. Secrets and environment files

Four files in `/etc/clinic`, outside the repository, each readable only by root
and the one service user that needs it:

| File          | Owner : group          | Mode   | Holds                                                   |
| ------------- | ---------------------- | ------ | ------------------------------------------------------- |
| `migrate.env` | `root : root`          | `0600` | the **owner's** URL — migrations only                   |
| `api.env`     | `root : clinic-api`    | `0640` | the `clinic_app` URL, the internal key, the media paths |
| `web.env`     | `root : clinic-web`    | `0640` | the internal key, the cookie secret, the site's origins |
| `backup.env`  | `root : clinic-backup` | `0640` | the `clinic_backup` URL and the backup settings         |

Generate every secret on the server and write the files in one step. Set the
three values at the top first. **`DB` is `clinic`** in production:

```bash
sudo bash <<'SCRIPT'
set -euo pipefail
DB=clinic
SITE=https://<SITE_HOST>
ORIGINS=$SITE

secret() { node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"; }
OWNER_PW=$(secret); APP_PW=$(secret); BACKUP_PW=$(secret); KEY=$(secret); COOKIE=$(secret)
umask 077
cat > /etc/clinic/migrate.env <<EOF
DATABASE_URL=postgresql://clinic_owner:${OWNER_PW}@127.0.0.1:5432/${DB}?schema=public
EOF
cat > /etc/clinic/api.env <<EOF
NODE_ENV=production
API_PORT=3001
DATABASE_URL=postgresql://clinic_app:${APP_PW}@127.0.0.1:5432/${DB}?schema=public
INTERNAL_API_KEY=${KEY}
MEDIA_STORAGE_DIR=/var/lib/clinic/media
BACKUP_STATUS_DIR=/var/lib/clinic/backup-status
EOF
cat > /etc/clinic/web.env <<EOF
DEPLOYMENT_MODE=production
API_BASE_URL=http://127.0.0.1:3001
INTERNAL_API_KEY=${KEY}
SESSION_COOKIE_SECRET=${COOKIE}
WEB_ALLOWED_ORIGINS=${ORIGINS}
PUBLIC_SITE_ORIGIN=${SITE}
NEXT_TELEMETRY_DISABLED=1
EOF
cat > /etc/clinic/backup.env <<EOF
BACKUP_DATABASE_URL=postgresql://clinic_backup:${BACKUP_PW}@127.0.0.1:5432/${DB}
MEDIA_STORAGE_DIR=/var/lib/clinic/media
BACKUP_DESTINATION_DIR=/var/backups/clinic
BACKUP_RECIPIENT_KEY_FILE=/etc/clinic/clinic-backup-public.asc
BACKUP_SIGNING_KEY_DIR=/var/lib/clinic-backup/signing-gnupg
BACKUP_RETENTION_DAYS=30
BACKUP_WORK_DIR=/var/tmp
EOF
chown root:root /etc/clinic/migrate.env && chmod 0600 /etc/clinic/migrate.env
chown root:clinic-api /etc/clinic/api.env && chmod 0640 /etc/clinic/api.env
chown root:clinic-web /etc/clinic/web.env && chmod 0640 /etc/clinic/web.env
chown root:clinic-backup /etc/clinic/backup.env && chmod 0640 /etc/clinic/backup.env

sudo -u postgres psql -q -d postgres -v database="$DB" -v owner_password="$OWNER_PW" \
  -v runtime_password="$APP_PW" -v backup_password="$BACKUP_PW" \
  -f /srv/clinic/apps/api/prisma/provision-roles.sql
SCRIPT
```

The last command is step 8's role provisioning, done here so the passwords are
never written anywhere but the files. To add `PASSWORD_BLOCKED_TERMS`, append it
to `api.env`. Notes:

- The Prisma URLs end in `?schema=public`; the backup URL must **not** (it is
  read by `psql` and `pg_dump`, which refuse the parameter).
- Nothing in `web.env` names the database (CLAUDE.md, Architecture boundary).
- `NEXT_TELEMETRY_DISABLED=1`: Next.js would otherwise report usage to its vendor.
- While the script runs, the passwords are briefly visible in the process list
  to anybody signed in to the server. On a server only the operator uses, that
  is accepted.

## 8. Database: roles and migrations

The roles and the database were created at the end of step 7 (README,
Provisioning a deployment). Migrate **as the owner**. `systemd-run` reads the
root-only file itself, so the owner's URL never passes through a shell, an
argument or the build user's environment:

```bash
sudo systemd-run --quiet --wait --pipe --collect --uid=clinic-build --gid=clinic-build -p EnvironmentFile=/etc/clinic/migrate.env -p WorkingDirectory=/srv/clinic/apps/api /usr/bin/pnpm exec prisma migrate deploy
```

It must end `All migrations have been successfully applied.`

## 9. The API

```bash
sudo install -m 0644 /srv/clinic/scripts/ops/systemd/clinic-api.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now clinic-api
```

```bash
timeout 30 bash -c 'until curl -fs http://127.0.0.1:3001/health/ready; do sleep 1; done'
```

It must answer `{"status":"ok","checks":{"database":"ok","media":"ok"}}`. If it
does not: `journalctl -u clinic-api`.

## 10. The first manager

Through the operator CLI, as the API's user with the API's environment (README,
Bootstrapping the first manager). The temporary password is printed once:

```bash
sudo systemd-run --quiet --wait --pipe --collect --uid=clinic-api --gid=clinic-api -p EnvironmentFile=/etc/clinic/api.env -p WorkingDirectory=/srv/clinic/apps/api /usr/bin/node dist/cli/main.js bootstrap-manager --username <username> --display-name "<display name>"
```

Every other operator command (`reset-password`, `run-jobs`, `purge-website-requests`)
runs the same way.

## 11. The web

`next build` rewrites a file in the source tree (`next-env.d.ts`), so it runs as
`clinic-build`; `systemd-run` gives it the web's environment without the build
user being able to read `web.env`. Then the build output is handed to
`clinic-web`, which writes its page and image caches into it at runtime. **The
API must be running**: the public pages are prerendered from it.

```bash
sudo rm -rf /srv/clinic/apps/web/.next && sudo systemd-run --quiet --wait --pipe --collect --uid=clinic-build --gid=clinic-build -p EnvironmentFile=/etc/clinic/web.env -p WorkingDirectory=/srv/clinic/apps/web /srv/clinic/apps/web/node_modules/.bin/next build && sudo chown -R clinic-web:clinic-web /srv/clinic/apps/web/.next
```

```bash
sudo install -m 0644 /srv/clinic/scripts/ops/systemd/clinic-web.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now clinic-web
```

```bash
timeout 30 bash -c 'until curl -fs http://127.0.0.1:3000/api/health; do sleep 1; done'
```

Next.js listens on `127.0.0.1:3000` only (the unit says so); nginx is the one way
in.

## 12. HTTPS

**Not rehearsed** (it needs a real domain whose `A` record points at the
server). Get the certificate first, with nginx stopped so certbot can answer on
port 80; the hooks are saved, so automatic renewal (`certbot.timer`) repeats the
same short stop:

```bash
sudo apt-get install -y certbot
```

```bash
sudo certbot certonly --standalone -d <SITE_HOST> -m <owner e-mail> --agree-tos --no-eff-email --pre-hook "systemctl stop nginx" --post-hook "systemctl start nginx"
```

Then the site. The template proxies to Next.js, sets the forwarded headers the
web tier trusts, allows a 12 MiB photograph, and logs neither addresses nor
query strings:

```bash
SITE_HOST=<the real host name>
```

```bash
sed "s/<SITE_HOST>/$SITE_HOST/g" /srv/clinic/scripts/ops/nginx/clinic.conf | sudo tee /etc/nginx/sites-available/clinic >/dev/null
```

```bash
sudo ln -sf /etc/nginx/sites-available/clinic /etc/nginx/sites-enabled/clinic && sudo rm -f /etc/nginx/sites-enabled/default && sudo nginx -t && sudo systemctl reload nginx
```

```bash
sudo certbot renew --dry-run
```

nginx's own logs are rotated by the package's logrotate rule (14 days).

## 13. Backups

As README, [Setting up the server](../README.md#setting-up-the-server); the
commands as rehearsed:

1. The backup login was provisioned in step 7.
2. Put the owner's public key on the server (it arrives by any means — it is not
   secret):

   ```bash
   sudo install -o root -g clinic-backup -m 0640 clinic-backup-public.asc /etc/clinic/clinic-backup-public.asc
   ```

3. The server's signing key, as `clinic-backup`; give its public half to the
   owner to keep with the backup key:

   ```bash
   cd /tmp && sudo -u clinic-backup gpg --homedir /var/lib/clinic-backup/signing-gnupg --batch --passphrase '' --quick-gen-key "Clinic server backup signing" ed25519 sign never
   ```

   ```bash
   sudo -u clinic-backup gpg --homedir /var/lib/clinic-backup/signing-gnupg --armor --export > clinic-server-signing-public.asc
   ```

4. Install the units, run one backup now and read its output:

   ```bash
   sudo install -m 0644 /srv/clinic/scripts/backup/systemd/clinic-backup.service /srv/clinic/scripts/backup/systemd/clinic-backup.timer /etc/systemd/system/ && sudo systemctl daemon-reload
   ```

   ```bash
   sudo systemctl start clinic-backup && journalctl -u clinic-backup -n 20 --no-pager -o cat
   ```

   It must end `BACKUP COMPLETE: /var/backups/clinic/clinic-backup-<time>.tar.gpg`.

5. Nightly:

   ```bash
   sudo systemctl enable --now clinic-backup.timer
   ```

## 14. Nightly jobs and log limits

```bash
sudo install -m 0644 /srv/clinic/scripts/ops/systemd/clinic-jobs.service /srv/clinic/scripts/ops/systemd/clinic-jobs.timer /etc/systemd/system/ && sudo systemctl daemon-reload
```

```bash
sudo systemctl start clinic-jobs && journalctl -u clinic-jobs -n 8 --no-pager -o cat
```

Four `SUCCEEDED` lines. Then:

```bash
sudo systemctl enable --now clinic-jobs.timer
```

```bash
sudo install -d /etc/systemd/journald.conf.d && sudo install -m 0644 /srv/clinic/scripts/ops/systemd/journald-clinic.conf /etc/systemd/journald.conf.d/clinic.conf && sudo systemctl restart systemd-journald
```

## 15. The clinic computer's collector

**Server side**, once the Windows install (README, [The clinic
collector](../README.md#the-clinic-collector)) has printed the collector's public
key line. Read the host key fingerprint the installer asks for:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

The key file, its directory and the login's home are owned by **root**, so the
collector login cannot edit or replace its own restriction:

```bash
sudo chown root:clinic-collect /var/lib/clinic-collector && sudo chmod 0750 /var/lib/clinic-collector && sudo install -d -o root -g clinic-collect -m 0750 /var/lib/clinic-collector/.ssh
```

```bash
echo 'restrict,command="env BACKUP_DESTINATION_DIR=/var/backups/clinic BACKUP_STATUS_DIR=/var/lib/clinic/backup-status /srv/clinic/scripts/backup/collector-serve.sh" <the ssh-ed25519 line printed on Windows>' | sudo tee /var/lib/clinic-collector/.ssh/authorized_keys >/dev/null && sudo chmod 0644 /var/lib/clinic-collector/.ssh/authorized_keys
```

The same restriction in `sshd`, for any key added later without it:

```bash
printf 'Match User clinic-collector\n    AuthenticationMethods publickey\n    DisableForwarding yes\n    PermitTTY no\n    ForceCommand env BACKUP_DESTINATION_DIR=/var/backups/clinic BACKUP_STATUS_DIR=/var/lib/clinic/backup-status /srv/clinic/scripts/backup/collector-serve.sh\n' | sudo tee /etc/ssh/sshd_config.d/20-clinic-collector.conf && sudo install -d -m 0755 /run/sshd && sudo sshd -t && sudo systemctl restart ssh
```

Check the `Match` applies to the collector and to nobody else:

```bash
sudo sshd -T -C user=clinic-collector,host=x,addr=127.0.0.1 | grep -i forcecommand && sudo sshd -T -C user=root,host=x,addr=127.0.0.1 | grep -i forcecommand
```

The first prints the forced command; the second prints `forcecommand none`.

Check the forced command answers, from any machine holding the collector's key
(the Windows install's first run does this too): `ssh clinic-collector@<server> list`
prints one line per archive; `ssh clinic-collector@<server> id` is refused.

## 16. Final checks

```bash
curl -fsS http://127.0.0.1:3001/health/ready && systemctl --no-pager list-timers 'clinic-*' && sudo ufw status
```

Then the whole site, from the server, with a real staff sign-in (the password
is read from stdin; README, Restoring, step 8):

```bash
VERIFY_WEB_URL=https://<SITE_HOST> VERIFY_STAFF_USERNAME=<username> node /srv/clinic/scripts/backup/verify-site.mjs
```

On a new clinic with no published photograph yet, add `VERIFY_MIN_PUBLIC_IMAGES=0`.
Record the commit (`readlink /srv/clinic`), the date and these outputs.

## 17. Upgrading to a new release

Every fix reaches the clinic this way. The new release is installed and built
**beside** the live one while the site keeps working; then the site closes for a
few minutes, the link `/srv/clinic` moves, and the site reopens. The previous
release is never modified: it stays built until a later upgrade, ready to go back
to (step 18). **Rehearsed** on 2026-10-02 (`docs/M10_A8_UPGRADE_REHEARSAL.md`).

### 17.1 Which kind of release

On the operator's computer, with the commit the server runs (`readlink /srv/clinic`
on the server) and the one to install:

```bash
git diff --stat <live commit> <new commit> -- apps/api packages pnpm-lock.yaml scripts/ops scripts/backup/systemd docs/DEPLOYMENT_RUNBOOK.md
```

| The diff lists                                                        | Kind            | The site is down for (2 CPUs, rehearsal) |
| --------------------------------------------------------------------- | --------------- | ---------------------------------------- |
| a file under `apps/api/prisma/migrations`                             | with migrations | <DOWNTIME_MIGRATIONS>                    |
| something under `apps/api`, `packages` or `pnpm-lock.yaml`, no migration | code            | <DOWNTIME_CODE>                          |
| none of those (the web alone)                                         | web only        | <DOWNTIME_WEB>                           |

"Down" means every page, public and staff, answers `502 Bad Gateway`. A change under
`scripts/ops`, `scripts/backup/systemd` or this page may bring a unit, an nginx
setting or an environment variable to install with the release: read it (17.5).

**With migrations, decide before the day:**

- Look up each new migration in the register (18.3). If any says **restore**, going
  back means restoring the backup taken when the site closed, and **everything
  entered after the new release opens is lost from the live system** (18.2). So:
  upgrade **outside clinic hours**, after the day's last record, and decide whether
  to keep the release before the clinic next opens. Not between 02:00 and 05:00
  Tehran, when the backup and the nightly jobs run.
- The **owner's backup key and its passphrase** are needed for the whole upgrade:
  the backup is proven by restoring it (17.3), and a rollback restores it. The owner
  exports the key on the owner's own computer, and it comes to the server only for
  the upgrade:

  ```bash
  gpg --armor --export-secret-keys "Clinic backups" > clinic-backup-secret.asc
  ```

  ```bash
  scp clinic-backup-secret.asc <you>@<server>:
  ```

### 17.2 Prepare (the site keeps working)

The release archive, from the operator's computer, as in step 5, then on the server:

```bash
OLD=$(basename "$(readlink /srv/clinic)") && NEW=<new commit> && echo "live $OLD, new $NEW"
```

```bash
sudo -u clinic-build install -d /srv/clinic-releases/$NEW && sudo -u clinic-build tar -xzf /tmp/clinic-release.tar.gz -C /srv/clinic-releases/$NEW
```

If that directory is left from an attempt that never went live, remove it first
(`sudo rm -rf /srv/clinic-releases/$NEW` — never the live one). Then install and
build the API, **in the release directory** (step 6):

```bash
cd /srv/clinic-releases/$NEW && sudo -u clinic-build -H env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile && sudo -u clinic-build -H pnpm build:contracts && sudo -u clinic-build -H pnpm --filter @clinic/api build
```

**Web only:** build the web now, against the running API (which this release does
not change), so the downtime is only a restart:

```bash
sudo systemd-run --quiet --wait --pipe --collect --uid=clinic-build --gid=clinic-build -p EnvironmentFile=/etc/clinic/web.env -p WorkingDirectory=/srv/clinic-releases/$NEW/apps/web /srv/clinic-releases/$NEW/apps/web/node_modules/.bin/next build && sudo chown -R clinic-web:clinic-web /srv/clinic-releases/$NEW/apps/web/.next
```

**Code and web only:** a backup now, while the site works. It is a safety net, not
the way back: going back to the previous code leaves the data as it is (18.1).

```bash
systemctl is-active clinic-backup clinic-jobs; sudo systemctl start clinic-backup && journalctl -u clinic-backup -n 1 --no-pager -o cat
```

`inactive` twice (nothing running), then `BACKUP COMPLETE: …`.

### 17.3 Close the site; with migrations, the backup and its proof

```bash
systemctl is-active clinic-backup clinic-jobs; sudo systemctl stop clinic-web
```

**The site is down from here.** With migrations, take the backup now, when nothing
can change any more, and remember its name:

```bash
sudo systemctl start clinic-backup && journalctl -u clinic-backup -n 1 --no-pager -o cat
```

```bash
PRE=$(sudo ls /var/backups/clinic | grep '\.tar\.gpg$' | tail -n 1) && echo "$PRE"
```

Prove it by restoring it — into a separate, new database, with the live release,
exactly as a rollback would — and then remove that copy:

```bash
sudo /srv/clinic-releases/$NEW/scripts/ops/restore-on-server.sh /var/backups/clinic/$PRE clinic_upgrade_check /var/lib/clinic/upgrade-check-media ~/clinic-backup-secret.asc
```

It asks for the key's passphrase and must end `RESTORE VERIFIED`.

```bash
sudo -u postgres dropdb clinic_upgrade_check && sudo rm -rf /var/lib/clinic/upgrade-check-media
```

If the restore does not verify, **stop here**: `sudo systemctl start clinic-web`
reopens the site on the release it was running, and the backup is what needs
fixing — an upgrade with migrations never goes ahead without a proven way back.

### 17.4 Switch

```bash
sudo systemctl stop clinic-api
```

**With migrations**, from the new release, as the owner (step 8):

```bash
sudo systemd-run --quiet --wait --pipe --collect --uid=clinic-build --gid=clinic-build -p EnvironmentFile=/etc/clinic/migrate.env -p WorkingDirectory=/srv/clinic-releases/$NEW/apps/api /usr/bin/pnpm exec prisma migrate deploy
```

It must end `All migrations have been successfully applied.` If it does not, do
not run it again and do not mark anything resolved: go back with 18.2.

Move the link and start the new API:

```bash
sudo ln -sfn /srv/clinic-releases/$NEW /srv/clinic && sudo systemctl start clinic-api && timeout 60 bash -c 'until curl -fs http://127.0.0.1:3001/health/ready; do sleep 1; done'
```

**Unless web only**, build the web against it — step 11's first command, unchanged
(`/srv/clinic` is now the new release):

```bash
sudo rm -rf /srv/clinic/apps/web/.next && sudo systemd-run --quiet --wait --pipe --collect --uid=clinic-build --gid=clinic-build -p EnvironmentFile=/etc/clinic/web.env -p WorkingDirectory=/srv/clinic/apps/web /srv/clinic/apps/web/node_modules/.bin/next build && sudo chown -R clinic-web:clinic-web /srv/clinic/apps/web/.next
```

Reopen the site:

```bash
sudo systemctl start clinic-web && timeout 60 bash -c 'until curl -fs http://127.0.0.1:3000/api/health; do sleep 1; done'
```

### 17.5 When the release changes a unit, nginx or an environment file

Only when 17.1's diff listed `scripts/ops`, `scripts/backup/systemd` or this page,
and only what the change says. While the site is down, after the link has moved:
a unit is installed from `/srv/clinic/...` as in steps 9, 11, 13 and 14, followed by
`sudo systemctl daemon-reload`; the nginx site is regenerated as in step 12; an
environment file is copied before it is edited (`sudo cp -p /etc/clinic/api.env
/etc/clinic/api.env.$OLD`). Going back puts back the previous release's units and
nginx site the same way, and the saved environment file.

**The nginx site never rewrites redirects.** The web answers every redirect with a
path (M10-B12), which the browser resolves against the address it used; the A7
`proxy_redirect` workaround is gone from `scripts/ops/nginx/clinic.conf` and must not
come back (`verify-site.mjs` fails a sign-in that leaves the site's address).

### 17.6 Checks, then keep or go back

```bash
readlink /srv/clinic && curl -fsS http://127.0.0.1:3001/health/ready && systemctl --no-pager --failed && systemctl --no-pager list-timers 'clinic-*'
```

The new commit; `{"status":"ok",…}`; `0 loaded units listed`; both timers.

```bash
VERIFY_WEB_URL=https://<SITE_HOST> VERIFY_STAFF_USERNAME=<username> node /srv/clinic/scripts/backup/verify-site.mjs
```

`SITE VERIFIED`. Then the journal since the switch, which must hold no error:

```bash
journalctl -u clinic-api -u clinic-web --since "-15 min" -p warning --no-pager
```

Then a manager looks at what the release changed. **Keep it, or go back (step 18)
before the clinic next opens.** When it is kept:

- Delete the owner's key from the server: `shred -u ~/clinic-backup-secret.asc`.
- Keep the live release and `$OLD`; remove older ones (`ls -1t /srv/clinic-releases`,
  then `sudo rm -rf /srv/clinic-releases/<older commit>` — never the live one or
  `$OLD`). Each kept release costs about <RELEASE_DISK> of disk.
- Record the date, `$OLD` → `$NEW`, the kind, the downtime, `$PRE` and the outputs.

## 18. Going back to the previous release

### 18.1 Code: move the link back

For a release without migrations, or whose migrations the register (18.3) marks
**code**. The previous release is still built; nothing is rebuilt, and **nothing
entered since the upgrade is lost**. The site is down for <DOWNTIME_ROLLBACK_CODE>.

```bash
sudo systemctl stop clinic-web clinic-api && sudo ln -sfn /srv/clinic-releases/$OLD /srv/clinic && sudo systemctl start clinic-api && timeout 60 bash -c 'until curl -fs http://127.0.0.1:3001/health/ready; do sleep 1; done' && sudo systemctl start clinic-web && timeout 60 bash -c 'until curl -fs http://127.0.0.1:3000/api/health; do sleep 1; done'
```

In a new shell `$OLD` is gone: `ls -1t /srv/clinic-releases` lists the releases,
newest first. If 17.5 changed anything, put the previous version back (17.5). Then
the checks of 17.6.

### 18.2 With migrations: restore the backup taken when the site closed

For a release whose migrations include one marked **restore**, or whose migration
failed. **What is lost, in plain words:** the clinic's records go back to the moment
the site closed for the upgrade. Everything entered on the new release —
appointments, sessions, payments, families, photographs, staff changes — is no
longer in the live system. It is not destroyed: it is set aside on the server, and
the list of what was done is read from it below, so staff can enter it again by
hand. **To avoid it:** upgrade outside clinic hours, run the checks before anybody
works, and decide before the clinic opens. Once the clinic has worked on the new
release, fix forward with another release unless the release itself endangers the
records.

The site is down for <DOWNTIME_ROLLBACK_RESTORE>. Close it and go back to the
previous code:

```bash
sudo systemctl stop clinic-web clinic-api && sudo ln -sfn /srv/clinic-releases/$OLD /srv/clinic && readlink /srv/clinic
```

Set the upgraded database and media aside — renamed and moved, nothing deleted.
**`DB` is `clinic`** in production:

```bash
DB=clinic && ASIDE=${DB}_rolled_back_$(date -u +%Y%m%d_%H%M) && echo "$ASIDE"
```

```bash
sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "ALTER DATABASE $DB RENAME TO $ASIDE" && sudo mv /var/lib/clinic/media /var/lib/clinic/media-$ASIDE
```

Restore the backup `$PRE` (17.3) under the live name, with the previous release:

```bash
sudo /srv/clinic-releases/$NEW/scripts/ops/restore-on-server.sh /var/backups/clinic/$PRE $DB /var/lib/clinic/media ~/clinic-backup-secret.asc
```

It must end `RESTORE VERIFIED`. Re-apply erasures that fell due since the backup was
taken (README, Restoring, step 6) — four `SUCCEEDED` lines:

```bash
sudo systemd-run --quiet --wait --pipe --collect --uid=clinic-api --gid=clinic-api -p EnvironmentFile=/etc/clinic/api.env -p WorkingDirectory=/srv/clinic/apps/api /usr/bin/node dist/cli/main.js run-jobs
```

Reopen on the previous release, whose web build is intact:

```bash
sudo systemctl start clinic-api && timeout 60 bash -c 'until curl -fs http://127.0.0.1:3001/health/ready; do sleep 1; done' && sudo systemctl start clinic-web && timeout 60 bash -c 'until curl -fs http://127.0.0.1:3000/api/health; do sleep 1; done'
```

Then the checks of 17.6, and put back anything 17.5 changed. **What has to be
entered again** — every audited action on the new release, from the end of its
migration:

```bash
sudo -u postgres psql -X -d $ASIDE -c "SELECT occurred_at AT TIME ZONE 'Asia/Tehran' AS tehran_time, action, entity_type, entity_id FROM audit_log WHERE occurred_at > (SELECT max(finished_at) FROM _prisma_migrations) ORDER BY occurred_at"
```

The set-aside database and media are outside every backup and every nightly
erasure. Keep them until the owner confirms everything in them was entered again,
then remove them, within 30 days:

```bash
sudo -u postgres dropdb $ASIDE && sudo rm -rf /var/lib/clinic/media-$ASIDE
```

Delete the owner's key as in 17.6. A fixed release is installed later as a new
upgrade (17), from the start.

### 18.3 Migration rollback register

Every migration, once applied, stays applied: none has a "down" script, and none
will — undoing a change by hand on financial tables guarded by immutability
triggers, under time pressure, is riskier than the restore every drill proves.
What a rollback needs is decided per migration:

- **code** — the previous release runs correctly on the migrated database, so 18.1
  is enough. Only for a purely additive change the previous release never reads
  or writes (a new table, a new nullable column, an index) that adds no rule — no
  trigger, constraint or narrowed grant — its writes could break. After such a
  rollback the nightly backups record the newer migration, so restoring one of
  them needs the newer release (README, Restoring, step 2).
- **restore** — anything else, including every change that rewrites or removes
  data. 18.2.

Each new migration states its class and the reason in its header, and adds a row
here in the same commit.

| Migration                                                              | Rollback | Why                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| every migration up to and including `20260930090000_m95_a10_erase_media_description` | —        | The schema production is installed with: no production upgrade crosses them.                                                                                                                                                                                                     |
| `20260930090000_m95_a10_erase_media_description` (an install older than it: staging before 2026-09-30, the A8 rehearsal) | restore  | It erases the description of every photograph already erased, irreversibly. The previous release's database client treats a description as never empty and its erasure job leaves the description in place, which the migration's new check refuses. Rehearsed (18.2). |

### 18.4 An install made before release directories (staging)

An install from the A7 runbook has `/srv/clinic` as a directory. Once, before its
first upgrade, turn it into the live release — a stop of about ten seconds:

```bash
C=<the commit it runs> && sudo install -d -o clinic-build -g clinic-build -m 0755 /srv/clinic-releases && sudo systemctl stop clinic-web clinic-api && sudo mv /srv/clinic /srv/clinic-releases/$C && sudo ln -s /srv/clinic-releases/$C /srv/clinic && sudo systemctl start clinic-api && sudo systemctl start clinic-web
```

Its build is untouched: every path it recorded under `/srv/clinic` still leads to the
same files.

## Not covered yet

- **Monitoring from outside** the server (an uptime check on `/health/ready`).
- A **restore** follows README, [Restoring (runbook)](../README.md#restoring-runbook).

## Appendix A — the staging rehearsal on WSL

A disposable, full-fidelity copy for the owner's tour and for rehearsing this
page. Synthetic data only; it never leaves the computer.

**What differs from production, and only this:**

| Step | Staging                                                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| —    | The server is a WSL distribution: `wsl --install Ubuntu-24.04 --name clinic-staging --location <folder> --no-launch`, as root                                      |
| 1    | `/etc/wsl.conf` adds `[time]` `useWindowsTimezone=false`, or WSL resets the clock zone to Windows' at every start                                                  |
| 1    | SSH listens on **2222** (`/etc/ssh/sshd_config.d/10-staging-port.conf`, `ufw allow 2222/tcp`), so it cannot meet a Windows SSH server on 22                        |
| 7    | `DB=clinic_demo`, `SITE=https://clinic-staging.test`, `ORIGINS=https://clinic-staging.test,https://localhost`                                                      |
| 10   | after the first manager: the practice clinic (README, The practice clinic), and the sample public content                                                          |
| 12   | a self-signed certificate (90 days, not a CA) for `clinic-staging.test`, `localhost`, `127.0.0.1`; no HSTS line; `scripts/ops/nginx/staging-noindex.conf` included |
| 13   | the "owner's key" is a throwaway made for staging                                                                                                                  |
| 15   | the collector connects to `127.0.0.1:2222` (`-Server 127.0.0.1 -Port 2222`)                                                                                        |

`.test` is reserved and never resolves on the internet, so canonical links and
the sitemap cannot point at a real site; the browser opens `https://localhost`.
The database name ends in `_demo` because the practice clinic refuses any other
— production's `clinic` can never receive it.

**The staging site is not indexable**: `robots.txt` disallows everything and
every response carries `X-Robots-Tag: noindex`. It is reachable only from this
computer.

**Remove everything** (the distribution, its disk, every user, key and
database in it; nothing else on Windows is touched):

```powershell
wsl --unregister clinic-staging
```

Tested on 2026-10-01 on the first rehearsal server: the distribution, its 4.9 GB disk
image and the `--location` folder were all removed, and the other WSL distributions
were untouched.

**How the rehearsal was run.** Pass 1 installed while this page was written. Pass 2
ran on a fresh distribution, executing this page's own `bash` blocks extracted in
order, with only the substitutions above; it found three more gaps, fixed here (the
SSH check on a server nobody has reached over SSH, health checks racing the service
start, and the redirect origin behind the proxy). Results: `docs/M10_A7_STAGING_REHEARSAL.md`.

**A phone on the same home network (optional).** Staging also accepts the laptop's
Wi-Fi address (certificate and `WEB_ALLOWED_ORIGINS`), but nothing on Windows forwards
to it: that needs a port proxy and a firewall rule, made by the owner as Administrator
and removed after the tour (`docs/STAGING_OWNER_NOTES.md`).
