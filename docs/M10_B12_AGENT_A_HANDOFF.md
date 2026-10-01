# M10-B12 staging handoff for Agent A

## Redirect fix and nginx cleanup

Web form and authentication route handlers now send a relative `Location` (for example, `/dashboard` or `/login`) with their 303 response. `request.url` was the internal Next.js URL at port 3000 behind nginx, so building a redirect from it exposed `https://<host>:3000/...` to the browser. A relative `Location` resolves against the browser's public HTTPS origin at any reverse proxy.

The `proxy_redirect ~^https?://[^/]+:3000(/.*)?$ $1;` line was removed from `scripts/ops/nginx/clinic.conf` and from the live staging `/etc/nginx/sites-available/clinic`; nginx passed `nginx -t` and was reloaded. **There is no `proxy_redirect` line in `docs/DEPLOYMENT_RUNBOOK.md` to remove.** Do not carry this directive into any new nginx config or upgrade instructions. The workaround text in `docs/M10_A7_STAGING_REHEARSAL.md` §4 item 22 and §5 B1 is historical; mark it superseded by this fix when folding the rehearsal notes into the runbook. Keep the forwarded host and port headers used by other Web code.

## Upgrade procedure gap

`docs/DEPLOYMENT_RUNBOOK.md` ends by saying the upgrade sequence is not rehearsed. The Web-only upgrade was performed on `clinic-staging` as follows; add a supported, rollback-aware version to the runbook:

1. Take and verify a staging backup before replacing files.
2. Record the currently deployed commit and keep a restorable copy of its source and `.next` build. This release was extracted in place, so the runbook still needs an atomic switch or tested rollback path.
3. Build a release archive from the intended commit and copy it to the staging host. Stop `clinic-web.service`, then extract as `clinic-build` into `/srv/clinic`.
4. **Set the working directory to `/srv/clinic`** before `pnpm install --frozen-lockfile`. Running `pnpm` from the Windows checkout through WSL produced `EPERM: operation not permitted, futime`; the command succeeded once run in `/srv/clinic`. The runbook must show the directory explicitly.
5. For a Web-only release with no dependency or schema changes, clear `/srv/clinic/apps/web/.next`, run the production Next build as `clinic-build` with `/etc/clinic/web.env` loaded, and transfer `.next` ownership to `clinic-web`. This rehearsal used `systemd-run --wait --pipe --collect --uid=clinic-build --gid=clinic-build -p EnvironmentFile=/etc/clinic/web.env -p WorkingDirectory=/srv/clinic/apps/web /srv/clinic/apps/web/node_modules/.bin/next build`.
6. Run `nginx -t` and reload nginx when the config changes. Start `clinic-web.service`, check all clinic services, `/api/health`, and form/auth redirects through `https://localhost/` with no nginx redirect rewriting.
7. Define separate API/schema migration, compatibility, and rollback steps before using this as a general upgrade procedure. They were outside this Web-only rehearsal.

The staging release built and started successfully after the B1 fix. The `proxy_redirect` directive is absent from the live nginx config. The tour uses only the synthetic practice clinic.

## Manager-only status B2

The receptionist still receives HTTP 200 with a streamed redirect to `/dashboard` for settlement and financial report pages, while `/staff` returns 307. Moving the page loading boundaries did not change the response and was reverted. An early, trustworthy permission gate is needed before response streaming; the tour index records this as an observation. No financial content was returned in the refused page.

## Owner-tour artifacts

The synthetic tour pack is in `E:\work\clinic\tour-pack\index.md`, with original and numbered, code-annotated screenshots under `screenshots/`. It includes desktop and mobile public pages, paired Manager/Receptionist views of shared pages, and a CSV report export. The index has the capture limits and observations. Consent withdrawal was stopped at its confirmation.
