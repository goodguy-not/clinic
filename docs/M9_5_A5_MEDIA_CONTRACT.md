# M9.5 A5 — media subsystem: cross-lane contract for Agent B

Agent A owns the backend design; this file is the surface Agent B integrates against.
Review it for **compatibility**, not for internal redesign. Everything named here is
frozen in `@clinic/contracts` and pinned by tests in `apps/api`.

## 1. Stable identity and the serving contract

There are two identifiers, and only one of them is an address.

| Thing       | Identifier   | Addressable?                                |
| ----------- | ------------ | ------------------------------------------- |
| media asset | `mediaId`    | **No.** An opaque handle for keying a list. |
| rendition   | rendition id | **Yes.** This is what bytes come from.      |
| master      | —            | **No row, no id, no route.** See §7.        |

The API returns a **relative path**, never a URL, and names no host:

```
media/<renditionId>          // PUBLIC_MEDIA_PATH_PREFIX + rendition id
```

It satisfies the existing `publicMediaPathSchema`, so the web tier resolves it exactly
as it already resolves a manager-typed `photoPath`.

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
| `cache-control`          | `public, max-age=300, s-maxage=300, must-revalidate` |
| `x-content-type-options` | `nosniff`                                            |
| `content-disposition`    | `inline` (no filename — see §7)                      |

`If-None-Match` is honoured and returns `304` with the same cache headers.

**Response on refusal (404)** — `{ error: { code: "MEDIA_NOT_FOUND", ... } }`, with
`cache-control: no-store`. A refusal is never cacheable, because a stored 404 would
outlive a manager changing their mind.

## 2. Responsive derivatives

Every published photograph arrives as a `PublicImage`:

```text
PublicImage {
  mediaId: string;
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
`PublicImage` rather than once per media id.

## 3. Where images appear in the public reads

Three projections gained a media field, across five reads. All are **additive** —
`photoPath` is untouched and still means what it meant.

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
  id, altText, status: 'ACTIVE' | 'ARCHIVED',
  width, height, byteSize,            // the master
  sourceContentType, sourceByteSize,  // what arrived; the bytes were never stored
  isPubliclyServed: boolean,          // <- can a stranger fetch this right now?
  renditions: MediaRendition[],       // id, path, format, width, height, byteSize, contentHash
  attachments: MediaAttachment[],
  createdAt, archivedAt,
  bytesPurgedAt: string | null, // always null today — see section 9
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

| Route                                      | Permission                      | Held by            |
| ------------------------------------------ | ------------------------------- | ------------------ |
| `GET /media`, `GET /media/:id`             | `media.read`                    | receptionist + mgr |
| `POST /media` (multipart)                  | `media.upload`                  | receptionist + mgr |
| `POST /media/:id/attachments`              | `media.attach`                  | receptionist + mgr |
| `PATCH /media/attachments/:id/framing`     | `media.attach`                  | receptionist + mgr |
| `DELETE /media/attachments/:id`            | `media.attach`                  | receptionist + mgr |
| `PATCH /media/attachments/:id/publication` | `media.publish`                 | **manager only**   |
| `PATCH /media/:id/archive`                 | `media.publish`                 | **manager only**   |
| `GET /media/renditions/:id/preview`        | `media.read` + owner read (§10) | see §10            |

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
- **A storage key, an uploader, a publication instant, an attachment id or a filename**,
  in any public projection. `publicImageSchema` is a strict object and a test pins its
  six keys.

## 8. Caching and revocation — the numbers, and the honest limits

`PUBLIC_MEDIA_REVOCATION_WINDOW_SECONDS = 300` (five minutes). It is the same constant
behind the `max-age`, the `s-maxage`, and the promise.

- **At the API origin, revocation is immediate.** The four-condition predicate is
  re-evaluated from live rows on every request, with nothing cached in the process. The
  next anonymous request after an unpublish, detach, archive or owner-unpublish is a 404.
- **In any cache Vala controls — the Next.js tier included — it is bounded by five
  minutes.** Web must not cache media bytes for longer than the `Cache-Control` the origin
  sets, and must tag its entries so a publication change purges them.
- **A copy that has already left is bounded by nothing.** A browser cache, a scraper, a
  search index, a proxy, a screenshot. Do not write UI copy that promises a family a
  photograph can be recalled from the internet. Content identity solves **replacement** —
  new bytes get new rendition ids — not **revocation**.

**Cache tags.** Bytes carry `PUBLIC_MEDIA_CACHE_TAG_PREFIX` + rendition id
(`public-media:<id>`). A media publication change also invalidates the **owner's** page
tags, because the projection listing the photograph is part of that page's data:

| Act                              | Tags to drop                                 |
| -------------------------------- | -------------------------------------------- |
| attachment published/unpublished | the owner's tags, as editing that owner does |
| asset archived/restored          | the tags of every owner it is attached to    |
| attachment detached              | the owner's tags                             |

**Every refusal is `404 MEDIA_NOT_FOUND`** — unknown id, unattached, draft-attached,
unpublished, owner unpublished, detached, archived, missing file. Do not build UI that
tries to distinguish them from the public side; two answers would let a stranger
enumerate the clinic's unpublished photographs.

## 9. Not in scope for A5

No upload UX, no library screen, no picker, **no crop or focal-point editor**, no
drag-and-drop ordering, no Next.js route handler for media bytes. Those are Agent B's, on
top of this contract — A5 provides the framing _state_ and the route that saves it, and
prescribes nothing about the interface that produces it.

No public-space presentation either: see section 3.

**Physical deletion and retention timing remain an open owner decision.** Nothing in the
API deletes a byte — there is no schedule, no duration, no route and no permission for
erasure — and no UI should imply that it does. `bytesPurgedAt` exists so that the
decision, when it is taken, is an ordinary piece of work rather than a redesign; it is
`null` on every asset and nothing in this product writes it. Treat it as read-only
information, and do not build a control that appears to trigger it.

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
`ACTIVE` asset the **same user** uploaded returns that asset (same `mediaId`, same
renditions, its original alt text) instead of creating a new one. The response shape and
status are unchanged. The identity is the SHA-256 of the uploaded bytes and lives in the
database, so it survives web and API restarts; the web tier's per-process duplicate
guard is no longer needed for correctness (removing it is the web lane's call). A
different photograph is always a new asset.

**Derivation is serialised.** Image processing runs one upload at a time per API
process; concurrent uploads queue. A worst-case upload takes a few seconds, so the web
tier's upload timeout should allow for one queued upload ahead of it.
