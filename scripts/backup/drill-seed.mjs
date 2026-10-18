#!/usr/bin/env node
/**
 * Milestone 10, checkpoint A2 — synthetic photographs for the restore drill.
 *
 * Called by drill.sh only, against a disposable API it started itself. Signs in
 * as the bootstrapped manager, replaces the temporary password, then uploads
 * generated images through the real API: one published portrait per public
 * therapist named, and one photograph uploaded but never attached, so the
 * backup carries both published and unpublished media.
 *
 * Every image is generated here, in code: flat synthetic colour, no photograph
 * of anything or anyone.
 *
 *   DRILL_API_URL, DRILL_INTERNAL_API_KEY, DRILL_MANAGER_USERNAME,
 *   DRILL_PUBLIC_THERAPISTS (comma-separated ids); stdin: the temporary
 *   password, then the new one, one per line.
 */
import { crc32, deflateSync } from 'node:zlib';

const api = process.env.DRILL_API_URL;
const key = process.env.DRILL_INTERNAL_API_KEY;
const username = process.env.DRILL_MANAGER_USERNAME;
const therapists = (process.env.DRILL_PUBLIC_THERAPISTS ?? '').split(',').filter(Boolean);
if (!api || !key || !username || therapists.length === 0) {
  throw new Error(
    'drill-seed: DRILL_API_URL, DRILL_INTERNAL_API_KEY, DRILL_MANAGER_USERNAME and DRILL_PUBLIC_THERAPISTS are required',
  );
}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const [temporaryPassword, newPassword] = Buffer.concat(chunks).toString('utf8').split(/\r?\n/);

/** A solid-colour PNG with a gradient, distinct per `seed`. */
function syntheticPng(seed, width = 900, height = 600) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) {
      raw[row + 1 + x * 3] = (seed * 53) % 256;
      raw[row + 2 + x * 3] = Math.floor((x / width) * 255);
      raw[row + 3 + x * 3] = Math.floor((y / height) * 255);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function call(method, path, session, body) {
  const headers = { 'x-internal-key': key };
  if (session) headers['x-session-id'] = session;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${api}${path}`, { method, headers, body: payload });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${text}`);
  return text === '' ? {} : JSON.parse(text);
}

async function upload(session, seed) {
  const form = new FormData();
  form.set('altText', 'تصویر مصنوعی برای آزمون بازیابی');
  form.set('file', new Blob([syntheticPng(seed)], { type: 'image/png' }), `drill-${seed}.png`);
  return (await call('POST', '/media', session, form)).media;
}

const signedIn = await call('POST', '/auth/login', null, { username, password: temporaryPassword });
const changed = await call('POST', '/auth/password', signedIn.sessionToken, {
  currentPassword: temporaryPassword,
  newPassword,
});
const session = changed.sessionToken;

let published = 0;
for (const [index, therapistId] of therapists.entries()) {
  const asset = await upload(session, index + 1);
  const attached = await call('POST', `/media/${asset.id}/attachments`, session, {
    ownerType: 'THERAPIST_PROFILE',
    ownerId: therapistId,
  });
  const attachmentId = attached.media.attachments[0].id;
  await call('PATCH', `/media/attachments/${attachmentId}/publication`, session, {
    isPublished: true,
  });
  published += 1;
}
await upload(session, 99);

process.stdout.write(`  seeded ${published} published portrait(s) and 1 unpublished photograph\n`);
