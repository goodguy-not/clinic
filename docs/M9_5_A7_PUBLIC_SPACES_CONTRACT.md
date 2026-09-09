# M9.5 A7 — public spaces, article imagery, handwritten testimonials: cross-lane contract

Agent A owns the backend design; this file is the surface Agent B integrates against for B7
and for the existing B4 workspace. Review it for **compatibility**, not for internal
redesign. Everything named here is frozen in `@clinic/contracts` and pinned by tests in
`apps/api`.

It builds on `M9_5_A5_MEDIA_CONTRACT.md`, which is **unchanged**. Every A5 invariant still
holds exactly as written there: attachment-specific framing, the master is never served,
EXIF/GPS stripped, a published attachment is required for anonymous reachability, immediate
origin revocation on unpublish/archive, and the five-minute cache window. A7 adds a fifth
attachment owner and changes none of it.

---

## 0. What changed for the Web lane, in one table

| Change                                                      | Breaks existing Web code? |
| ----------------------------------------------------------- | ------------------------- |
| `PUBLIC_SPACE` added to `MEDIA_ATTACHMENT_OWNERS`           | No — additive             |
| `CLINIC_SPACE` semantics                                    | **No — untouched**        |
| `publicTestimonialSchema` gains `kind`                      | No — additive             |
| `createTestimonialRequestSchema` gains `kind` (defaulted)   | No — defaults to `TYPED`  |
| `PUBLIC_CACHE_TAGS.spaces` added                            | No — additive             |
| New routes under `/content/spaces` and `GET /public/spaces` | No — new                  |
| `PUBLIC_SPACE_NOT_FOUND` added to `ERROR_CODES`             | **Yes — one line.** §9    |

Only the last row needs work in `apps/web`, and it is one Persian sentence. See §9.

---

## 1. `CLINIC_SPACE` is untouched, and that is deliberate

**A7 does not repurpose `CLINIC_SPACE`.** It stays exactly what A5 froze:

- `ownerId` is `null` **exactly** for `CLINIC_SPACE`, and required for every other owner type;
- it has no owner row, so a manager publishing the attachment is the whole of the control;
- **no public projection in this product returns one**, before A7 or after it.

That matters because the media workspace shipped in B6 parks an uploaded-and-framed
photograph on the ownerless `CLINIC_SPACE` slot precisely _because_ it has no public
surface — the page says so in its own copy ("جایگاه عمومی تازه‌ای نمی‌سازد"). Redefining
`CLINIC_SPACE` to require an owner would have turned that drafting sandbox into a live
public-gallery target, which is exactly the coupling this checkpoint exists to prevent, and
would have broken `apps/web/src/app/api/media/draft-attachment/route.ts` at the same time.

So A7 adds a **fifth** owner type instead:

```text
MEDIA_ATTACHMENT_OWNERS = [
  'THERAPIST_PROFILE',   // owner row, ownerId required
  'PUBLIC_ARTICLE',      // owner row, ownerId required
  'PUBLIC_TESTIMONIAL',  // owner row, ownerId required
  'CLINIC_SPACE',        // NO owner row, ownerId MUST be null, no public projection
  'PUBLIC_SPACE',        // owner row, ownerId required   <- A7
]
```

`PUBLIC_SPACE` behaves like the first three in every respect. `CLINIC_SPACE` is the odd one
out and always was.

> **Revisit trigger.** When the web tier gains a first-class "prepared but unplaced"
> concept of its own, `CLINIC_SPACE` becomes vocabulary with nothing behind it and should be
> retired in a reviewed migration. Until then it is load-bearing for B6.

---

## 2. Public spaces — the staff surface

### The record

```text
Space {
  id: string;
  name: string;                      // WORKING DRAFT — not what a visitor reads
  description: string | null;        // WORKING DRAFT
  displayOrder: number;              // WORKING DRAFT, 0..1000
  isPublic: boolean;
  hasUnpublishedChanges: boolean;    // derived; see below
  firstPublishedAt: string | null;
  publicRevisedAt: string | null;
  createdAt: string;
}
```

**The copy is held twice, exactly as an article's is.** `name`, `description` and
`displayOrder` on this shape are the draft. What the website says lives in separate
published columns the API never exposes on this shape — read it from `GET /public/spaces`,
which is the only place live copy belongs.

`hasUnpublishedChanges` is the same field, with the same meaning and the same caveats, as
`Article.hasUnpublishedChanges`: **true only while the space is public**, derived in the read
so it cannot go stale, and carrying **no diff and no field names**. A management screen uses
it to say "a publication is outstanding"; showing _what_ changed is a comparison the UI would
have to make against the public read, and no diff format is decided.

**`displayOrder` is split with the copy, and this is the one difference from an article.**
Reordering a published gallery is a change a visitor sees, so it takes effect on
publication, not on save. A UI that lets a receptionist drag entries must therefore expect
the public order not to move until a manager publishes each moved space — and
`hasUnpublishedChanges` goes true for exactly that reason.

### Routes and permissions

| Route                                   | Permission             | Held by            |
| --------------------------------------- | ---------------------- | ------------------ |
| `GET /content/spaces`                   | `public_space.read`    | receptionist + mgr |
| `GET /content/spaces/:id`               | `public_space.read`    | receptionist + mgr |
| `POST /content/spaces`                  | `public_space.draft`   | receptionist + mgr |
| `PATCH /content/spaces/:id`             | `public_space.draft`   | receptionist + mgr |
| `PATCH /content/spaces/:id/publication` | `public_space.publish` | **manager only**   |

Gate the publish control on `public_space.publish` exactly as the article publish control is
gated on `article.publish`.

`GET /content/spaces` returns **draft order** (`displayOrder`, then id) — it is the working
list, and somebody who has just moved an entry expects to see it where they put it. The
public gallery orders by the _published_ order.

### Requests

```text
POST   /content/spaces          { name, description: string|null, displayOrder: 0..1000 }
PATCH  /content/spaces/:id      same shape (a full statement, not a partial patch)
PATCH  /content/spaces/:id/publication   { isPublic: boolean }
```

All three are **strict objects**. An extra `isPublic` on a create, or a `roomId` on
anything, is `VALIDATION_FAILED` (400) — not an ignored field. `name` and `description` are
plain text: no `<` anywhere, enforced in the contract and again by a database CHECK, so the
web tier renders them as text with no sanitiser and no `dangerouslySetInnerHTML`.

`PATCH .../publication` with `isPublic: true` **is also the approval of a pending change** —
one act, one control, exactly as an article's is. There is no separate "approve" route.

### Refusals

| Code                     | Status | Situation                                           |
| ------------------------ | ------ | --------------------------------------------------- |
| `PUBLIC_SPACE_NOT_FOUND` | 404    | no such space, on any of the five routes            |
| `VALIDATION_FAILED`      | 400    | markup, empty name, order out of range, extra field |

---

## 3. Public spaces — the anonymous read

```text
GET /public/spaces  ->  { spaces: PublicSpace[] }

PublicSpace {
  name: string;
  description: string | null;
  images: PublicImage[];      // the A5 shape, unchanged
}
```

**Three keys, and a test pins the list exactly.** No id, no slug, no publication flag, no
display order, no timestamp — and no room id, room status, service restriction, capacity or
availability, because `public_space` holds no reference to `room` and the two tables cannot
be joined at all (see §6).

Ordered by the clinic's **published** display order, then first-publication instant, then id.
The order is total, so the gallery does not reshuffle between requests.

`images` is `PublicImage[]` — the same shape as an article's, with `framing` present on every
entry. An **empty array is the normal state**: a space may be published with words and no
picture, and a picture prepared for it stays invisible until a manager publishes that
attachment too.

Cache tag: `PUBLIC_CACHE_TAGS.spaces` = `public-spaces`. There is no per-space prefix, because
a space has no address of its own. Drop it when a space is published or unpublished, and when
a media attachment on a space is published, unpublished or detached. A space **draft** edit
drops nothing — no public read can see one. It never affects `sitemap`: a space is not a
data-driven page and appears in no URL list.

---

## 4. Space imagery — two manager gates

A space's photograph is an ordinary A5 attachment:

```text
POST /media/:mediaId/attachments
  { ownerType: 'PUBLIC_SPACE', ownerId: <space id>, position: 0 }
```

`ownerId` is **required** here (unlike `CLINIC_SPACE`). A null one is `VALIDATION_FAILED`; a
space that does not exist is `PUBLIC_SPACE_NOT_FOUND` (404).

Two gates stand between the bytes and a stranger, and **both are the manager's**:

| Gate                 | Permission             | Where the UI sets it                       |
| -------------------- | ---------------------- | ------------------------------------------ |
| attachment published | `media.publish`        | `PATCH /media/attachments/:id/publication` |
| space published      | `public_space.publish` | `PATCH /content/spaces/:id/publication`    |

Both must be open. **Either one closing revokes the bytes at the origin on the very next
request**, with no interval — including unpublishing the _space_ while the attachment stays
published, which is the condition A7 adds. `MediaAttachment.ownerIsPublic` reports the space's
own publication for a `PUBLIC_SPACE` attachment, so the library can tell a colleague which
gate is closed.

Attaching remains **drafting** and remains the receptionist's: it cannot publish, there is no
field on the request that could ask it to, and detaching or re-framing a _published_
attachment is still refused with `MEDIA_ATTACHMENT_PUBLISHED` (409).

---

## 5. Article imagery — no mechanism changed, one property confirmed

A7 adds **nothing** here. `article-imagery.int-spec.ts` states the property the checkpoint
requires, over the A2 and A5 machinery that already existed:

- a receptionist preparing an illustration produces a **draft** attachment
  (`publishedAt: null`), and it is not anonymously reachable as article content;
- a manager may approve the picture while the article is still a draft — legal, silent, and
  exactly what preparing a launch looks like;
- publishing the **article** is then the single act that makes the words and the approved
  picture reachable together;
- unpublishing the article takes its imagery down with it at the origin, immediately;
- replacement follows the A5 rule — unpublish, detach, attach, publish — and the old
  rendition id stops answering while the new one is a different resource.

Nothing about the article publication or permission model moved.

---

## 6. Public space is not an operational room

**This is a frozen product boundary, and it is enforced by an absence rather than by a
projection.** `public_space` holds no reference to `room`, `room` holds none to
`public_space`, and the two tables share no foreign key — asserted against the live
PostgreSQL catalogue in two suites.

Consequences the Web lane can rely on:

- creating, renaming, restricting or **deactivating** a room publishes nothing and changes no
  space — there is no path from one row to the other;
- no room id, room status, service restriction, availability window or scheduling meaning can
  reach a visitor through a space;
- the clinic may publish a corridor or a garden that is not a room, or one entry covering
  three rooms, and may run six rooms while publishing none.

**Do not build a UI that implies the two are linked** — no "publish this room to the website"
control on the rooms screen, no room picker on the space editor, no count of rooms on a
public page. A nullable manager-set link was considered and rejected for this checkpoint;
if a product decision later needs the join, it is a new migration with its own reasoning,
not something a screen may assume.

Permission-side: `room.create`, `room.update` and `room.update_status` remain manager-only
and are untouched. The receptionist still holds `room.read` alone.

---

## 7. Handwritten testimonials

```text
Testimonial        gains  kind: 'TYPED' | 'HANDWRITTEN'
PublicTestimonial  gains  kind: 'TYPED' | 'HANDWRITTEN'
create/update      gain   kind (defaults to 'TYPED')
```

**The transcription is the authoritative public meaning. The photograph never is.**

- `body` is **required for both kinds** — by the request contract, by a NOT NULL column, and
  by two database CHECKs. A `HANDWRITTEN` testimonial with an empty, whitespace-only or
  absent body is `VALIDATION_FAILED` (400), and the row is refused even by raw SQL.
- An image may accompany a handwritten testimonial through the existing
  `PUBLIC_TESTIMONIAL` attachment. It is never required, and it can never stand in for the
  words.
- A typed testimonial remains valid with no image, exactly as before.

**There is no OCR in this API, and no field that could hold its output.** A test asserts the
exact column list of `public_testimonial` against the live catalogue, so an `ocr_text` or
`transcription_confidence` column cannot arrive without failing a build.

> **If the web tier ever offers transcription as a drafting aid** — and nothing requires it
> to — what it saves must be what a **human read, corrected and accepted**, submitted through
> the ordinary `POST`/`PATCH /content/testimonials` route. It is then indistinguishable from
> typing, which is the point. Do not label anything in the UI as machine-verified, and do not
> auto-submit a transcription a person has not read.

### Privacy is unchanged

`status` (manager approval) is still the privacy review and `isPublic` is still placement;
`testimonial.approve` still covers both and is still manager-only. Nothing from an unapproved
testimonial or its image reaches a visitor — including when a manager has published the
_attachment_, which is the strongest thing that can be true short of approving the words.
Withdrawing approval unpublishes the quotation in the same transaction and makes its
photograph a 404 at the origin.

**No identifying or clinical field was added**, and a test asserts the absence of fourteen
named ones. `kind` says how the words arrived and nothing about who wrote them.

**The clinic's consent policy is not encoded anywhere.** H0 — how consent to publish a
family's words is obtained, recorded, versioned and withdrawn — remains an owner and legal
decision. No column, constant, default or copy in this checkpoint guesses at it, and no UI
should imply the system holds a consent record.

---

## 8. What the web tier can never receive

Everything in A5 §7, plus:

- **any operational room fact through a public space** — no id, status, restriction,
  availability or capacity, and none of them exists on the row;
- **a space's draft copy through a public read** — `GET /public/spaces` selects the published
  columns only;
- **a space id, slug, publication flag, display order or timestamp** in any public
  projection; `publicSpaceSchema` is a strict object and a test pins its three keys.

---

## 9. The one mechanical change `apps/web` needs

`ERROR_CODES` gains `PUBLIC_SPACE_NOT_FOUND`. `apps/web/src/server/errors-fa.test.ts`
asserts that every contract code has a Persian message, so **that test fails until one line is
added** to `apps/web/src/server/errors-fa.ts`:

```ts
PUBLIC_SPACE_NOT_FOUND: 'این فضای عمومی پیدا نشد.',
```

Agent A did not make this edit: the A7 brief scopes `apps/web` to the Web lane. The Persian
wording above follows the existing recoverable-refusal pattern in that file and should be
confirmed by whoever owns the copy.

Nothing else in `apps/web` breaks. The `CLINIC_SPACE` usages in
`draft-attachment/route.ts`, `media-routes.test.ts` and `media-api-client.test.ts` all pass
`ownerId: null`, which is still exactly what that owner type requires.

---

## 10. Not in scope for A7

No B7 presentation or UI of any kind — no gallery layout, no space editor, no ordering
control, no transcription aid. A7 provides the state and the routes that save it, and
prescribes nothing about the interface.

No consent model, no retention decision, no physical deletion. `bytesPurgedAt` is still null
on every asset and nothing in this product writes it.

No room-to-space link, in either direction.
