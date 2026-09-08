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

## 3. Where images appear in the public reads

Four projections gained a media field. All four are **additive** — `photoPath` is
untouched and still means what it meant.

| Read                         | New field                         |
| ---------------------------- | --------------------------------- |
| `GET /public/team`           | `therapists[].photo` — nullable   |
| `GET /public/team/:slug`     | `therapist.photo` — nullable      |
| `GET /public/articles`       | `articles[].images` — array       |
| `GET /public/articles/:slug` | `article.images` — array          |
| `GET /public/testimonials`   | `testimonials[].image` — nullable |
| `GET /public/clinic-profile` | `clinic.spacePhotos` — array      |

Arrays are ordered by the clinic's own `position`, then by attachment id. An empty
array and a `null` are the normal, expected states — most rows will have neither a
photograph nor an error.

**Web-lane changes already made in this repository** (three fixture lines and one
Persian map, no component work): `apps/web/src/server/public-site.ts` gives its
fallback clinic profile `spacePhotos: []`, `errors-fa.ts` gains nine Persian media
messages, and `public-site.test.ts` fixtures gain the new keys. Nothing in
`apps/web/src/app` or `src/components` was touched — the rendering is Agent B's.

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
}

MediaAttachment {
  id, ownerType, ownerId, position, attachedAt,
  publishedAt: string | null,   // <- the MANAGER's decision. null = draft.
  ownerIsPublic: boolean,       // <- the WORLD's state, independent of the above.
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

| Route                                      | Permission      | Held by            |
| ------------------------------------------ | --------------- | ------------------ |
| `GET /media`, `GET /media/:id`             | `media.read`    | receptionist + mgr |
| `POST /media` (multipart)                  | `media.upload`  | receptionist + mgr |
| `POST /media/:id/attachments`              | `media.attach`  | receptionist + mgr |
| `DELETE /media/attachments/:id`            | `media.attach`  | receptionist + mgr |
| `PATCH /media/attachments/:id/publication` | `media.publish` | **manager only**   |
| `PATCH /media/:id/archive`                 | `media.publish` | **manager only**   |

Attaching **always** creates an unpublished attachment; the request has no field that
could ask otherwise. Detaching a **published** attachment is refused — unpublish first,
which is a manager act. Gate the publish and archive controls on `media.publish` exactly
as the article publish control is gated on `article.publish`.

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
  five keys.

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

No upload UX, no library screen, no picker, no cropping, no drag-and-drop ordering, no
Next.js route handler for media bytes. Those are Agent B's, on top of this contract.
Physical deletion and retention timing remain an open owner decision — nothing in the
API deletes a byte, and no UI should imply that it does.
