# M9.5 A5 — media subsystem: cross-lane contract for Agent B

Agent A owns the backend design; this file is the surface Agent B integrates against.
Review it for **compatibility**, not for internal redesign. Everything named here is
frozen in `@clinic/contracts` and pinned by tests in `apps/api`.

## 1. Stable identity and the serving contract

There are two identifiers, and only one of them is an address.

| Thing       | Identifier   | Addressable?                                               |
| ----------- | ------------ | ---------------------------------------------------------- |
| media asset | asset `id`   | **No.** Staff surfaces only; never in a public projection. |
| rendition   | rendition id | **Yes.** This is what bytes come from.                     |
| master      | —            | **No row, no id, no route.** See §7.                       |

Since A10 a visitor-facing response identifies a photograph **only by its rendition
paths**. Key a public list by the first rendition's `path`.

The API returns a **relative path**, never a URL, and names no host:

```
media/<renditionId>          // PUBLIC_MEDIA_PATH_PREFIX + rendition id
```

It satisfies the existing `publicMediaPathSchema`. (The manager-typed therapist
`photoPath` it was once resolved beside was dropped in the Milestone 9.5 stabilisation.)

Behind it, on the API:

```
GET /public/{path}      →  GET /public/media/<renditionId>
```

`@InternalOnly()` like every other public route: the browser asks Next.js, Next.js asks
NestJS across the private network with the internal key. Nothing here changes the
boundary.

**Response on success (200)**

| Header                   | Value                                                |
| ------------------------ | ---------------------------------------------------- |
| `content-type`           | `image/webp` or `image/jpeg`                         |
| `content-length`         | exact byte size, matching the rendition's `byteSize` |
| `etag`                   | `"<sha256 of these exact bytes>"` (strong)           |
| `cache-control`          | `private, no-cache` (`PUBLIC_MEDIA_CACHE_CONTROL`)   |
| `x-content-type-options` | `nosniff`                                            |
| `content-disposition`    | `inline` (no filename — see §7)                      |

`If-None-Match` is honoured and returns `304` with the same `etag` and `cache-control`,
**after** the servability check and **without** reading the file (A10). See §8.

**Response on refusal (404)** — `{ error: { code: "MEDIA_NOT_FOUND", ... } }`, with
`cache-control: no-store`. A refusal is never cacheable, because a stored 404 would
outlive a manager changing their mind.

## 2. Responsive derivatives

Every published photograph arrives as a `PublicImage`:

```text
PublicImage {
  alt: string; // Persian, required, plain text — render it, never a placeholder
  width: number; // intrinsic width of the LARGEST rendition
  height: number; // and its height. Use these to reserve layout space.
  renditions: {
    path: string; // "media/<renditionId>"
    format: 'webp' | 'jpeg';
    width: number; // the `w` descriptor
    height: number;
    byteSize: number;
  }[];
  framing: MediaFraming; // always present; never absent, never optional
}

MediaFraming {
  focalX: number; // 0..1, fraction of the frame. 0.5 = centre.
  focalY: number; // 0..1
  crop: { x: number; y: number; width: number; height: number } | null;
}
```

- Widths come from `MEDIA_RENDITION_WIDTHS` = `[320, 640, 960, 1280, 1920]`, **filtered to
  those smaller than the master, plus the master's own width**. Nothing is ever enlarged,
  so a modest photograph legitimately has two or three renditions, at unlisted widths.
  Do not assume a fixed set.
- Both formats are always present at every width. Build a `<picture>` with a `webp`
  `<source>` and a `jpeg` fallback `<img>`.
- `width`/`height` are **post-orientation**: a photograph taken sideways already reports
  the size it will occupy. Do not apply any rotation.
- Renditions arrive ordered by width ascending, then format.

### Framing

`framing` says **which part of the frame matters**. It is the answer to "her face is off
to the left in the round avatar", and it has one defining property:

**The renditions are always the WHOLE FRAME. Framing is a description, never an edit.**
Nothing on the API side ever crops a pixel. No rendition is re-derived when framing
changes, the master is never read or rewritten, and no byte moves.

Three consequences, and all three are contract:

- **Framing changes without re-uploading.** It is one request carrying six numbers.
- **Framing can never destroy the source.** A crop is reversible for ever, because the
  parts of the photograph outside it were never thrown away.
- **Web can preview a crop live.** Applying a normalised rectangle and a focal point to
  an image the browser already holds is CSS, so a crop handle moves with no request in
  the loop and the save at the end is one call.

Every number is a **fraction of the frame, 0 to 1 — never a pixel**. Pixels would mean
something different at each rendition width, so a crop chosen against one would be wrong
on the rest. `crop` is all-or-nothing: four values or `null`. The unframed default is
`DEFAULT_MEDIA_FRAMING` = `{ focalX: 0.5, focalY: 0.5, crop: null }`, which is exactly
what a browser does to an image nobody has framed.

**Framing belongs to the ATTACHMENT — to this use of the photograph — not to the asset
and not to the master.** One master attached in two places carries two framings, and
changing one does not move the other. That is why `framing` arrives inside each
`PublicImage` rather than once per photograph.

## 3. Where images appear in the public reads

Three projections gained a media field, across five reads. All were **additive**; the
legacy therapist `photoPath` they sat beside was removed in the Milestone 9.5
stabilisation, so `photo` is now the only portrait field.

| Read                         | New field                         |
| ---------------------------- | --------------------------------- |
| `GET /public/team`           | `therapists[].photo` — nullable   |
| `GET /public/team/:slug`     | `therapist.photo` — nullable      |
| `GET /public/articles`       | `articles[].images` — array       |
| `GET /public/articles/:slug` | `article.images` — array          |
| `GET /public/testimonials`   | `testimonials[].image` — nullable |

Arrays are ordered by the clinic's own `position`, then by attachment id. An empty
array and a `null` are the normal, expected states — most rows will have neither a
photograph nor an error.

**`PublicClinicProfile` has NO media field.** It carries thirteen owner-supplied facts
and nothing else, and a test pins that list exactly. A5 can hold, attach, publish and
serve a photograph of the clinic's own rooms — `CLINIC_SPACE` is one of the four
attachment targets and the bytes are anonymously retrievable once a manager publishes
the attachment — but **A5 deliberately does not decide where such photographs appear**,
in what order, under what heading, how many there may be, or whether they belong to that
profile at all. That is public-space presentation, it belongs to the checkpoint that
builds it, and no public projection in this product returns them. Nothing here freezes
it.

**Web-lane changes already made in this repository** (one Persian map and some test
fixtures, no component work): `errors-fa.ts` gains nine Persian media messages, and
`public-site.test.ts` fixtures gain the new keys. Nothing in `apps/web/src/app`,
`src/components` or `src/server/public-site.ts` was touched — the rendering is Agent
B's.

## 4. Attachment and publication state (staff surface)

`GET /media` and `GET /media/:id` return `MediaAsset`:

```text
MediaAsset {
  id, status: 'ACTIVE' | 'ARCHIVED',
  altText: string | null,             // null EXACTLY when erased (A10) — see §9
  width, height, byteSize,            // the master
  sourceContentType, sourceByteSize,  // what arrived; the bytes were never stored
  isPubliclyServed: boolean,          // <- can a stranger fetch this right now?
  renditions: MediaRendition[],       // id, path, format, width, height, byteSize, contentHash
  attachments: MediaAttachment[],
  createdAt, archivedAt,
  bytesPurgedAt: string | null, // set by the nightly erasure — see section 9
}

MediaAttachment {
  id, ownerType, ownerId, position, attachedAt,
  publishedAt: string | null,   // <- the MANAGER's decision. null = draft.
  ownerIsPublic: boolean,       // <- the WORLD's state, independent of the above.
  framing: MediaFraming,        // <- this USE's composition. See section 2.
}
```

`isPubliclyServed` is computed with the same predicate the serving route applies, in the
same statement — the library cannot say "not public" about something the origin is still
handing out. `publishedAt` and `ownerIsPublic` are separate so the UI can tell a colleague
**which** gate is closed.

**Owner types** (`MEDIA_ATTACHMENT_OWNERS`): `THERAPIST_PROFILE`, `PUBLIC_ARTICLE`,
`PUBLIC_TESTIMONIAL`, `CLINIC_SPACE`. `ownerId` is `null` **exactly** for `CLINIC_SPACE`
and required for the other three — sending the wrong shape is `VALIDATION_FAILED`.

## 5. Routes and permissions

| Route                                      | Permission                                     | Held by            |
| ------------------------------------------ | ---------------------------------------------- | ------------------ |
| `GET /media`, `GET /media/:id`             | `media.read`                                   | receptionist + mgr |
| `POST /media` (multipart)                  | `media.upload`                                 | receptionist + mgr |
| `POST /media/:id/attachments`              | `media.attach`                                 | receptionist + mgr |
| `PATCH /media/attachments/:id/framing`     | `media.attach`                                 | receptionist + mgr |
| `DELETE /media/attachments/:id`            | `media.attach`                                 | receptionist + mgr |
| `PATCH /media/:id/alt-text`                | `media.attach` (+ `media.publish` once served) | see below          |
| `PATCH /media/attachments/:id/publication` | `media.publish`                                | **manager only**   |
| `PATCH /media/:id/archive`                 | `media.publish`                                | **manager only**   |
| `GET /media/renditions/:id/preview`        | `media.read` + owner read (§10)                | see §10            |

Attaching **always** creates an unpublished attachment; the request has no field that
could ask otherwise. Detaching a **published** attachment is refused — unpublish first,
which is a manager act. Gate the publish and archive controls on `media.publish` exactly
as the article publish control is gated on `article.publish`.

**Re-framing a published attachment is refused for the same reason** —
`MEDIA_ATTACHMENT_PUBLISHED` (409). The weaker authority must not change what is on a
live page, so a manager re-frames a published image by unpublishing, re-framing and
republishing: three audited acts rather than one silent one. A crop editor should
therefore expect to operate on unpublished attachments, and should surface that refusal
rather than retrying.

**Framing request body** — exactly the `MediaFraming` shape from section 2 and nothing
else. It is a strict object: an extra `isPublished`, `ownerId` or `position` is
`VALIDATION_FAILED`, not an ignored field. Out-of-range values, a crop that runs off the
frame, a zero-area crop and a partially stated crop are all `VALIDATION_FAILED` too.

**Correcting a description** (Milestone 9.5 stabilisation; erased photographs refused
since A10 with `MEDIA_NOT_FOUND`, because there is nothing left to describe) —
`PATCH /media/:id/alt-text`,
body `{ altText }` with the upload's rules. The description is the **asset's**: one
correction reaches every place the photograph is used. While the asset is not publicly
served, a receptionist or manager may correct it; once it is served anywhere, only a
manager may (`AUTH_FORBIDDEN`, 403, for a receptionist). Response
`{ media: MediaAsset, publications: MediaPublicationIdentity[] }` — one identity per
**live** attachment, empty when nothing changed or the asset is not served. Pass each to
`invalidateMediaPublication`.

**Upload request** — `multipart/form-data`:

- one file part named `file`
- one text field `altText` (Persian, 1–200 chars, no `<`)
- 201 on success, body `{ media: MediaAsset }`

The filename and the browser's `Content-Type` are **not read**. Do not put a family name
in the filename expecting it to be recorded; it is deliberately recorded nowhere.

## 6. Refusal codes

All nine are in `ERROR_CODES` and all nine already have Persian messages in
`errors-fa.ts`.

| Code                         | Status | Situation                                        |
| ---------------------------- | ------ | ------------------------------------------------ |
| `MEDIA_TYPE_UNSUPPORTED`     | 415    | not JPEG/PNG/WebP by its bytes (SVG, PDF, …)     |
| `MEDIA_FILE_TOO_LARGE`       | 413    | over 12 MiB; raised while the body is arriving   |
| `MEDIA_FILE_CORRUPT`         | 422    | accepted type, no decoder can read it            |
| `MEDIA_IMAGE_UNUSABLE`       | 422    | under 200 px a side, or over 50 MP               |
| `MEDIA_NOT_FOUND`            | 404    | anything not fetchable / not found (see §8)      |
| `MEDIA_ARCHIVED`             | 409    | attaching or publishing an archived asset        |
| `MEDIA_ATTACHMENT_NOT_FOUND` | 404    | missing or already-detached attachment           |
| `MEDIA_ALREADY_ATTACHED`     | 409    | same photograph offered twice to one owner       |
| `MEDIA_ATTACHMENT_PUBLISHED` | 409    | detaching something the public can currently see |

`VALIDATION_FAILED` (400) covers a missing file part, a missing or markup-carrying
`altText`, and an owner-id shape that contradicts the owner type.

## 7. What the web tier can never receive

- **The uploaded photograph.** It is never written to disk; only a sanitised master and
  its renditions are stored. No EXIF exists anywhere in the system, so no GPS coordinate
  does either.
- **The master.** It has no row in the table the serving route selects from and no
  identifier anybody could send.
- **Any internal identifier** — an asset id, an attachment id, an owner id — or a storage
  key, an uploader, a publication instant or a filename, in any public projection.
  `publicImageSchema` is a strict object and a test pins its five keys (`alt`, `width`,
  `height`, `renditions`, `framing`). The only id a visitor ever sees is the rendition id
  inside a rendition `path`, which is the address of the bytes and nothing else.

## 8. Caching and revocation — the target (A10), and the honest limits

`PUBLIC_MEDIA_CACHE_CONTROL = 'private, no-cache'`. It replaces A5's five-minute window;
`PUBLIC_MEDIA_REVOCATION_WINDOW_SECONDS` and `PUBLIC_MEDIA_MAX_AGE_SECONDS` are gone.

- **Revocation is immediate at Vala's Web origin.** The API re-evaluates the servability
  predicate from live rows on every request, and the Web route asks the API on every
  request (upstream `cache: 'no-store'`, no Data Cache entry, as B9 already does). The next
  visitor request after an unpublish, detach, archive, owner-unpublish or erasure is a 404
  at `/media/<id>` on the clinic's domain. The Web tier must never answer a media request
  from anything it stored without an API `200` or `304` **on that request**.
- **What a visitor's browser may keep, and for how long.** The bytes, for as long as the
  browser's own cache keeps anything — but it may **never reuse them without asking**.
  `no-cache` means store-and-revalidate; there is no `max-age`, so there is no window in
  which a revoked photograph is shown from cache without a check. `private` means no shared
  cache (ISP or corporate proxy, a CDN) may store them at all.
- **A repeat view revalidates cheaply.** The browser sends `If-None-Match: "<sha256>"`; the
  Web route forwards it; the API runs the servability check and, if the tag matches,
  answers `304` with no body and **no file read** — one indexed query per image. A
  revoked image answers `404` (`no-store`), which the browser will not replace with its
  stored copy.
- **A copy that has already left is bounded by nothing.** The bytes in a browser cache, a
  screenshot, a scraper, a search index. Do not write UI copy that promises a family a
  photograph can be recalled from the internet. Content identity solves **replacement** —
  new bytes get new rendition ids — not **revocation**.

**What the Web route must do (Agent B, next checkpoint):**

| Upstream | Web answers the browser with                                                |
| -------- | --------------------------------------------------------------------------- |
| `200`    | `200`, the bytes, and the upstream `etag` and `cache-control` **unchanged** |
| `304`    | `304`, no body, the upstream `etag` and `cache-control` unchanged           |
| anything | `404 MEDIA_NOT_FOUND`, `cache-control: no-store`, no `etag`                 |

Forward the browser's `If-None-Match` upstream (B9 already does). Stop overriding
`cache-control` with `private, no-store, …`: that override is what makes every view a
full download. Do not weaken it to anything carrying a `max-age`, `s-maxage` or `public`.

**Cache tags.** `PUBLIC_MEDIA_CACHE_TAG_PREFIX` (`public-media:<renditionId>`) named Web
cache entries for bytes; since B9 there are none, so dropping those tags is a harmless
no-op the Web lane may retire. A media publication change still invalidates the
**owner's** page tags, because the projection listing the photograph is part of that page's
data:

| Act                              | Tags to drop                                 |
| -------------------------------- | -------------------------------------------- |
| attachment published/unpublished | the owner's tags, as editing that owner does |
| asset archived/restored          | the tags of every owner it is attached to    |
| attachment detached              | the owner's tags                             |

**Every refusal is `404 MEDIA_NOT_FOUND`** — unknown id, unattached, draft-attached,
unpublished, owner unpublished, detached, archived, erased, missing file. Do not build UI
that tries to distinguish them from the public side; two answers would let a stranger
enumerate the clinic's unpublished photographs. (A missing file behind a live row is
noticed on the next full fetch, not on a matching revalidation — the visitor already holds
exactly the bytes the hash names.)

## 9. Not in scope for A5

No upload UX, no library screen, no picker, **no crop or focal-point editor**, no
drag-and-drop ordering, no Next.js route handler for media bytes. Those are Agent B's, on
top of this contract — A5 provides the framing _state_ and the route that saves it, and
prescribes nothing about the interface that produces it.

No public-space presentation either: see section 3.

**Erasure** (Milestone 10 A3; description added in Milestone 9.5 A10). A nightly job erases
a photograph uploaded 30 days ago and never attached, one archived 30 days ago, and every
photograph ever attached to a testimonial whose consent was withdrawn. Erasure removes the
master, every rendition **and the description**: `bytesPurgedAt` is set and `altText` is
`null`, together, always (a database CHECK). The asset row stays in the library with its
attachments and dates, and the audit trail keeps only `media.bytes_erased` with the rule
that applied. An erased photograph cannot be attached, published, restored or re-described
— each answers `MEDIA_NOT_FOUND` — and none of its renditions can be fetched or previewed.
There is no route or permission that erases on demand; do not build a control that appears
to trigger it. Displaying an erased photograph to staff (no description, no image) is the
Web lane's work.

## 10. Staff preview of persisted draft media (added after A8)

Why: once the uploader's browser-local preview is gone, a manager otherwise has no way to
see a persisted draft image before deciding to publish it. The public route (§1, §8) is
**unchanged** and still refuses every unpublished image.

**Request** — NestJS, through the server-only client, never from the browser:

```
GET /media/renditions/<renditionId>/preview
x-internal-key: <internal key>
x-session-id:   <the signed-in user's session token>
```

- `renditionId` is `MediaAsset.renditions[].id` from `GET /media` or `GET /media/:id`.
  Pick a size the same way as for public images. Not an asset id: the master cannot be
  named.
- **Response 200**: the rendition's bytes. `Content-Type` is the rendition's own type
  (`MEDIA_RENDITION_CONTENT_TYPE[format]`), plus `Content-Length`,
  `X-Content-Type-Options: nosniff`, `Content-Disposition: inline` (no filename), and
  **`Cache-Control: private, no-store`** (`MEDIA_PREVIEW_CACHE_CONTROL`). No `ETag`.
  The bytes are identical to what the public route serves once the image is live: the
  stored, re-encoded, metadata-free rendition. Never the upload, never the master.

**Who sees what.** The caller needs `media.read`, and the asset must be `ACTIVE`, not
erased, and have at least one **standing** (not detached) attachment on an owner whose
draft the caller can read. Publication is not checked either way.

| Attachment owner                                            | Also required                    |
| ----------------------------------------------------------- | -------------------------------- |
| `PUBLIC_ARTICLE`                                            | `article.read`                   |
| `PUBLIC_TESTIMONIAL`                                        | `testimonial.read`               |
| `PUBLIC_SPACE`                                              | `public_space.read`              |
| `THERAPIST_PROFILE`                                         | `therapist.draft_public_profile` |
| `CLINIC_CONTENT_ENTRY`, `CLINIC_OPEN_GRAPH`, `CLINIC_SPACE` | `clinic_profile.read` (manager)  |

So with today's roles the manager can preview every attached draft, and the receptionist
can preview article, testimonial, public-space and therapist-profile drafts. The
receptionist **cannot** preview images parked in `CLINIC_SPACE` (the upload component's
default target). Unattached uploads and archived assets cannot be previewed by anyone.

**Refusals**

| Status | Code                        | When                                                                                                        |
| ------ | --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 401    | `AUTH_SESSION_INVALID` etc. | no, expired or revoked session (the usual session codes)                                                    |
| 401    | `AUTH_INTERNAL_KEY_INVALID` | missing internal key                                                                                        |
| 403    | `AUTH_FORBIDDEN`            | no `media.read`                                                                                             |
| 400    | `VALIDATION_FAILED`         | `renditionId` is not a UUID                                                                                 |
| 404    | `MEDIA_NOT_FOUND`           | everything else: unknown, unattached, only detached, archived, erased, or no attachment the caller can read |

Error bodies are the usual JSON envelope with `Cache-Control: no-store`.

**What the web tier must do**

- Serve it from an authenticated, session-checked Route Handler (or equivalent). With no
  valid session cookie it must refuse, not fall back to the public route. Copying the URL
  into a logged-out browser must not work.
- Fetch upstream with `cache: 'no-store'` and **no** cache tag. Forward
  `MEDIA_PREVIEW_CACHE_CONTROL` unchanged. Never reuse the public media handler, its
  300-second window or its `public-media:` tags.
- Apply the attachment's `framing` in CSS, exactly as for public images.
- Keep public pages on `/media/<id>`. Preview is only for internal screens (article and
  testimonial review, later the B8 draft preview).

## 11. Stabilisation changes (2026-09-23)

Three behaviour changes, all on the API side. **No contract schema changed.**

**Servability equals the owner's public projection.** A rendition is anonymously
servable only while its owner would appear in its public read. The owner conditions are
one SQL fragment per owner kind (`apps/api/src/common/public-reachability.ts`), read by
the public projections and by the serving predicate alike. Anything that takes an owner
off the site — deactivating a therapist or a service, unpublishing an article or a space,
withdrawing a testimonial's approval, clearing a content block's heading — refuses its
bytes at the origin on the very next request. The one visible change for the web tier:

- **A published `CLINIC_SPACE` attachment is no longer anonymously servable.** No page
  reads that owner, so its bytes had no public owner. Publishing one still succeeds and
  the library reports its page as not live (`ownerIsPublic: false`); staff keep seeing it
  through §10's preview. The web tier's `CLINIC_SPACE` staging use is unaffected.

**A retried upload does not duplicate.** `POST /media` with bytes identical to an
`ACTIVE` asset the **same user** uploaded returns that asset (same asset `id`, same
renditions, its original alt text) instead of creating a new one. The response shape and
status are unchanged. The identity is the SHA-256 of the uploaded bytes and lives in the
database, so it survives web and API restarts; the web tier's per-process duplicate
guard is no longer needed for correctness (removing it is the web lane's call). A
different photograph is always a new asset.

**Derivation is serialised.** Image processing runs one upload at a time per API
process; concurrent uploads queue. A worst-case upload takes a few seconds, so the web
tier's upload timeout should allow for one queued upload ahead of it.

## 12. Public contract cleanup and description erasure (A10, 2026-09-30)

- **`PublicImage.mediaId` is removed.** No public projection carries an internal
  identifier; a photograph is identified by its rendition paths (§1, §7). Checked across
  every public read — services, team, articles, testimonials, spaces, clinic content,
  clinic profile, sitemap, request submission: slugs, a slot enum and `received: true`
  are the only other keys that identify anything, and none is an internal id. The error
  envelope's `requestId` is a per-request correlation id for support, not a record id,
  and is kept.
- **`MediaAsset.altText` is `string | null`**, null exactly when erased (§4, §9).
  Migration `20260930090000_m95_a10_erase_media_description`: `alt_text` nullable, the
  erasure guard lets the erasure clear it, existing erased rows are cleared
  (**destructive for those rows**), and `media_asset_description_erasure_chk` ties it to
  `bytes_purged_at`.
- **Caching** is `private, no-cache` with cheap revalidation (§1, §8).
