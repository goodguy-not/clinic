# M9.5 A9 — service imagery: cross-lane contract for Agent B

Agent A owns the backend design; this file is the surface Agent B integrates against.
Review it for **compatibility**, not for internal redesign. Everything named here is
frozen in `@clinic/contracts` and pinned by tests in `apps/api`.

It builds on `M9_5_A5_MEDIA_CONTRACT.md` and changes nothing in it. Read that first;
this document states only what is new.

## 1. What this checkpoint adds

One sentence: **a service can now carry one published photograph, through the same
media subsystem as everything else.**

| Thing                     | Value                                                |
| ------------------------- | ---------------------------------------------------- |
| New attachment owner type | `PUBLIC_SERVICE`                                     |
| Owner id                  | **Required** — the service's internal id             |
| New public field          | `PublicServiceSummary.image` — `PublicImage \| null` |
| New permission            | **None**                                             |
| New error code            | **None** (`SERVICE_NOT_FOUND` already existed)       |
| New route                 | **None**                                             |

Nothing else about a service moved. The name, the description, the slug, the session
lengths and every rule about who may write them are exactly as checkpoint A6 left them.

## 2. How a service image is represented

Identically to a therapist portrait or a testimonial image. It is a `PublicImage` —
`mediaId`, `alt`, `width`, `height`, `renditions[]`, `framing` — and every rule in the A5
contract applies unchanged: the path is relative (`media/<renditionId>`), the renditions
are the whole frame, `framing` is a CSS description and never an edit, both formats are
present at every width, and the widths are not a fixed set.

**One photograph, not a gallery.** `image` is a single nullable `PublicImage`, mirroring
`publicTestimonialSchema.image`. The attachment table can hold more than one; the
projection returns the first by the clinic's own `position`. Do not build a carousel —
the accepted design has one slot on the list stage and one on the detail hero, which is
what this field is for.

**`null` is the normal state.** Most services will have no photograph, and a service
published with words alone is a perfectly ordinary service. Render the existing empty
state. Both service pages in `apps/web` already have one:

- `src/components/public-service-explorer.tsx` — `.public-service-stage__image`
- `src/app/(public)/services/[slug]/page.tsx` — `.b2-service-detail__photo`

Those two placeholders are where `image` goes, and replacing them is the whole of the
public-side work.

## 3. Public projection shape

Both service reads gained the field. Both are additive; nothing was removed or renamed.

| Read                         | Shape                                                 |
| ---------------------------- | ----------------------------------------------------- |
| `GET /public/services`       | `services[].image` — `PublicImage \| null`            |
| `GET /public/services/:slug` | `service.image` — same field, inherited by the detail |

```text
PublicServiceSummary {
  slug: string;
  name: string;
  description: string | null;
  image: PublicImage | null;   // <- new in A9
}

PublicServiceDetail = PublicServiceSummary & {
  sessionDurationsMinutes: number[];
}
```

`publicServiceSummarySchema` is a **strict object** and a test pins its four keys, so a
fixture that omits `image` now fails the parse. Web fixtures that construct a service
response must carry it — `apps/web/src/server/public-site.test.ts` was updated in this
checkpoint and is the example.

**Still absent, and still deliberately so:** no service id, no `isPublic`, no `status`,
no `createdAt`, no actor, no price, no availability. The internal id is selected as a
join key for the media lookup and dropped before the response; an integration test
asserts the response body does not contain it.

**Cache tags are unchanged.** `PUBLIC_CACHE_TAGS.services` and
`PUBLIC_SERVICE_CACHE_TAG_PREFIX + slug` mean what they meant. Bytes carry
`PUBLIC_MEDIA_CACHE_TAG_PREFIX + renditionId` as they do everywhere. A publication change
to a service image should drop the service's page tags as well as the byte tag, for the
reason stated in A5 §8.

## 4. Attachment behaviour (staff surface)

`POST /media/:id/attachments` with:

```json
{ "ownerType": "PUBLIC_SERVICE", "ownerId": "<the service's internal id>", "position": 0 }
```

- `ownerId` is **required**. Sending `null` is `400 VALIDATION_FAILED` — `PUBLIC_SERVICE`
  is not one of the ownerless types.
- An unknown service id is `404 SERVICE_NOT_FOUND`.
- **Attach time asks only that the service exists.** Preparing a photograph for a service
  that is private, retired or unaddressed is normal drafting and is accepted. Whether the
  picture ever reaches a visitor is decided on every read, never cached at attach time.
- Attaching **always** produces an unpublished attachment. There is no field on the
  request that could ask otherwise.
- Framing, detaching, re-framing and the `MEDIA_ATTACHMENT_PUBLISHED` refusal all behave
  exactly as A5 §5 describes. Nothing here is special-cased.

The service's internal id is available on the internal editorial surface — the A6 service
public-copy routes are keyed by it (`GET /catalog/services/:serviceId/public-copy`), and
the editor at `src/app/(internal)/content/services/[id]/` already has it in the route
parameter. Use the existing `media-upload-framing.tsx` component with
`ownerType: 'PUBLIC_SERVICE'` and that id; no new component is needed.

**Permissions, unchanged:**

| Act                           | Permission      | Held by            |
| ----------------------------- | --------------- | ------------------ |
| upload                        | `media.upload`  | receptionist + mgr |
| attach / re-frame / detach    | `media.attach`  | receptionist + mgr |
| publish / unpublish / archive | `media.publish` | **manager only**   |

## 5. Preview behaviour

`GET /media/renditions/:renditionId/preview` works for service images with no change to
the route, the headers or the caching rules — see A5 §10, which remains the contract.

The only addition is one row in the owner→permission map:

| Attachment owner | Also required (besides `media.read`) |
| ---------------- | ------------------------------------ |
| `PUBLIC_SERVICE` | `service.draft_public_copy`          |

Both roles hold `service.draft_public_copy`, so **the receptionist and the manager can
both preview a draft service image**, including one prepared for a service nobody has
published. That permission is the editorial read of a service's public copy; it reaches
no operational field and publishes nothing.

Everything else is as before: serve it from an authenticated, session-checked Route
Handler, fetch upstream with `cache: 'no-store'` and no cache tag, forward
`MEDIA_PREVIEW_CACHE_CONTROL` unchanged, and never reuse the public media handler. The
existing handler at `src/app/api/media/renditions/[renditionId]/preview/route.ts` already
does all of this and needs no change.

## 6. Publication semantics — two gates, both the manager's

A service photograph is visible when **all four** A5 conditions hold, and the fourth —
"the owner is itself public" — means three things for a service:

```
asset ACTIVE and not erased
  AND the attachment stands (not detached)
  AND a manager published the attachment          <- media.publish
  AND the service is PUBLICLY REACHABLE:
        is_public = true
        AND status = 'ACTIVE'
        AND public_slug IS NOT NULL               <- service.update / service.update_status
```

Those are the same three conditions `GET /public/services` has applied since Milestone 9
checkpoint A1, so **the picture and the page appear and disappear together**. In
particular:

| The manager does this               | The service page | The photograph                 |
| ----------------------------------- | ---------------- | ------------------------------ |
| unpublishes the attachment          | stays            | gone; slot returns to empty    |
| archives the asset                  | stays            | gone from every page at once   |
| sets `isPublic: false`              | gone (404)       | gone                           |
| **deactivates the service**         | gone (404)       | **gone** — this is the A9 case |
| gives an unaddressed service a slug | appears          | appears, with no re-upload     |

Deactivation is worth its own line because it writes `status` and leaves `is_public`
standing. A design that gated the picture on the flag alone would have taken the page
down and gone on serving the photograph; this one does not.

**Revocation timing is exactly A5 §8** and this checkpoint does not improve it: immediate
at the API origin, bounded by `PUBLIC_MEDIA_REVOCATION_WINDOW_SECONDS` (300) in caches
Vala controls, and bounded by nothing for a copy that has already left. Do not write UI
copy promising a family that a photograph can be recalled from the internet.

**Refusals are still one answer.** An unpublished, draft, detached, archived or
owner-withdrawn image is `404 MEDIA_NOT_FOUND`, with `cache-control: no-store`. Do not
build UI that tries to tell them apart from the public side.

## 7. What Agent B has to change

1. Render `image` in the two service slots named in §2, applying `framing` in CSS exactly
   as for a therapist portrait, and keeping the Persian empty state for `null`.
2. Add the media upload/framing control to the internal service copy editor with
   `ownerType: 'PUBLIC_SERVICE'` and the service id already in the route.
3. Nothing else. No new route handler, no new Persian error message, no new cache tag, no
   preview changes.

## 8. Not in scope for A9

No service redesign, no catalog change, no media library, no retention or deletion, no
B8, and no gallery. `bytesPurgedAt` is still `null` on every asset and nothing in this
product writes it.

## 9. Open follow-up, recorded not fixed

`LIVE_ATTACHMENT_PREDICATE` gates a `THERAPIST_PROFILE` photograph on `is_public` alone,
while the team projection also requires `status = 'ACTIVE'`. Deactivating a therapist
writes only `status`, so a colleague who has left disappears from `/public/team` while
their portrait bytes stay retrievable by anybody already holding the rendition id. This
checkpoint deliberately did not change therapist semantics; the finding is recorded in
`DECISION_LOG.md` (2026-09-21) with the two-line fix and its revisit trigger. Nothing in
the web lane needs to act on it.
