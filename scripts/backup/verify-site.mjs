#!/usr/bin/env node
/**
 * Milestone 10, checkpoint A2 — the live half of restore verification.
 *
 *   VERIFY_WEB_URL=https://... VERIFY_STAFF_USERNAME=<username> \
 *     node scripts/backup/verify-site.mjs < password-file
 *
 * Run against the restored environment once the API and web are started on it.
 * It proves what verify.sh cannot see from the database:
 *
 *   1. the public site renders: every public page reachable from the home page
 *      within two links answers 200;
 *   2. its published images render: every `/media/<rendition>` those pages
 *      reference is served as an image — so the restored rows, the restored
 *      files and the serving path agree. At least VERIFY_MIN_PUBLIC_IMAGES
 *      (default 1; 0 for a clinic with no published photograph) must be found;
 *   3. a colleague can sign in through the web tier exactly as a browser does
 *      (CSRF pair, Origin, session cookie), reach the dashboard, and sign out.
 *
 * The password is read from stdin, never from an argument or the environment,
 * for the reason the operator CLI refuses `--password`. The sign-in is a real,
 * audited login.
 *
 * Exits non-zero on the first failure, naming it.
 */

const MEDIA_URL = /\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const LINK = /href="(\/[^"#?]*)"/g;
const NOT_PUBLIC = ['/api', '/_next', '/media', '/login', '/change-password', '/dashboard'];
const MAX_PAGES = 60;

function fail(message) {
  process.stderr.write(`\n[verify-site] FAILED: ${message}\n`);
  process.exit(1);
}

function ok(message) {
  process.stdout.write(`  OK   ${message}\n`);
}

const webUrl = process.env.VERIFY_WEB_URL;
const username = process.env.VERIFY_STAFF_USERNAME;
const minImages = Number(process.env.VERIFY_MIN_PUBLIC_IMAGES ?? '1');
if (!webUrl || !username) fail('VERIFY_WEB_URL and VERIFY_STAFF_USERNAME are required.');
if (!Number.isInteger(minImages) || minImages < 0) {
  fail('VERIFY_MIN_PUBLIC_IMAGES must be 0 or more.');
}
const origin = new URL(webUrl).origin;

async function readPassword() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const password = Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '';
  if (password === '') fail('no password on stdin.');
  return password;
}

async function get(path, headers = {}) {
  return fetch(new URL(path, origin), {
    redirect: 'manual',
    headers,
    signal: AbortSignal.timeout(20_000),
  });
}

// --- 1 and 2: the public site and its images --------------------------------

async function checkPublicSite() {
  process.stdout.write('\n==> Public site\n');
  const queue = [{ path: '/', depth: 0 }];
  const seen = new Set(['/']);
  const images = new Set();

  while (queue.length > 0) {
    const { path, depth } = queue.shift();
    const response = await get(path);
    if (response.status !== 200) fail(`public page ${path} answered ${response.status}.`);
    const html = await response.text();

    for (const match of html.matchAll(MEDIA_URL)) images.add(match[0]);

    if (depth >= 2) continue;
    for (const [, link] of html.matchAll(LINK)) {
      const clean = link.replace(/\/$/, '') || '/';
      if (seen.has(clean) || seen.size >= MAX_PAGES) continue;
      if (NOT_PUBLIC.some((prefix) => clean === prefix || clean.startsWith(`${prefix}/`))) continue;
      if (/\.[a-z0-9]+$/i.test(clean)) continue;
      seen.add(clean);
      queue.push({ path: clean, depth: depth + 1 });
    }
  }
  ok(`${seen.size} public page(s) answered 200`);

  for (const image of images) {
    const response = await get(image);
    const type = response.headers.get('content-type') ?? '';
    const bytes = Buffer.from(await response.arrayBuffer());
    if (response.status !== 200) fail(`published image ${image} answered ${response.status}.`);
    if (!type.startsWith('image/')) fail(`published image ${image} came back as "${type}".`);
    if (bytes.byteLength === 0) fail(`published image ${image} was empty.`);
  }
  if (images.size < minImages) {
    fail(
      `found ${images.size} published image(s) on the public site; expected at least ${minImages}.`,
    );
  }
  ok(
    `${images.size} published image rendition(s) referenced by those pages, each served as an image`,
  );
}

// --- 3: a colleague signs in ------------------------------------------------

function cookieJar() {
  const jar = new Map();
  return {
    take(response) {
      for (const line of response.headers.getSetCookie()) {
        const [pair] = line.split(';');
        const index = pair.indexOf('=');
        jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
      }
    },
    header() {
      return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    },
    entries() {
      return [...jar];
    },
  };
}

async function csrfFrom(path, jar) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await get(path, { cookie: jar.header() });
    jar.take(response);
    const html = await response.text();
    const token = /name="csrfToken" value="([^"]+)"/.exec(html)?.[1];
    if (token) return token;
  }
  return fail(`${path} rendered no CSRF token.`);
}

async function post(path, jar, fields) {
  const response = await fetch(new URL(path, origin), {
    method: 'POST',
    redirect: 'manual',
    headers: {
      origin,
      cookie: jar.header(),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  jar.take(response);
  return response;
}

async function checkStaffLogin(password) {
  process.stdout.write('\n==> Staff sign-in\n');
  const jar = cookieJar();
  const csrfToken = await csrfFrom('/login', jar);

  const login = await post('/api/auth/login', jar, { csrfToken, username, password });
  const landing = new URL(login.headers.get('location') ?? '/', origin);
  if (login.status !== 303 || landing.searchParams.has('error')) {
    fail(
      `sign-in as ${username} was refused (${login.status} → ${landing.pathname}${landing.search}).`,
    );
  }
  if (!['/dashboard', '/change-password'].includes(landing.pathname)) {
    fail(`sign-in landed on ${landing.pathname}.`);
  }
  ok(`${username} signed in through the web tier`);

  const page = await get(landing.pathname, { cookie: jar.header() });
  if (page.status !== 200) {
    fail(`${landing.pathname} answered ${page.status} to the signed-in colleague.`);
  }
  ok(`${landing.pathname} rendered for the signed-in session`);

  // The rebound CSRF token is the value of the cookie that carried the pre-login one.
  const csrfCookie = jar.entries().find(([name]) => name.toLowerCase().includes('csrf'));
  if (csrfCookie === undefined) fail('no CSRF cookie after sign-in.');
  const logout = await post('/api/auth/logout', jar, { csrfToken: csrfCookie[1] });
  if (logout.status !== 303) fail(`sign-out answered ${logout.status}.`);
  ok('signed out; no session left open');
}

const password = await readPassword();
await checkPublicSite();
await checkStaffLogin(password);
process.stdout.write(
  '\nSITE VERIFIED: public pages and published images render; staff sign-in works.\n',
);
