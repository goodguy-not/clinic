import { Prisma } from '@prisma/client';

/**
 * THE ONE PREDICATE THAT DECIDES WHAT A STRANGER MAY SEE.
 *
 * Milestone 9.5, checkpoint A5. It is a single SQL fragment in a single file
 * because every read that depends on it has to agree with every other read that
 * depends on it. The serving route uses it to decide whether to hand over
 * bytes; the public projections use it to decide whether to name an image;
 * the staff library uses it to tell a manager whether something is currently
 * visible. Three answers to that question would be three chances for the
 * library to say "not public" about a photograph the origin is still serving.
 *
 * IT IS EVALUATED ON EVERY REQUEST, AGAINST LIVE ROWS, AND IS NEVER CACHED
 * INSIDE THIS APPLICATION. That is what makes the frozen rule true at the
 * origin: unpublishing, detaching, archiving, or unpublishing the article or
 * profile the photograph hangs off makes the very next anonymous request a
 * refusal, with no interval and no warm-up. What happens in caches BEYOND this
 * origin is bounded separately and stated in
 * `PUBLIC_MEDIA_REVOCATION_WINDOW_SECONDS`.
 *
 * FOUR CONDITIONS, ALL REQUIRED:
 *
 *  1. THE ASSET IS IN CIRCULATION. A manager can archive one photograph and
 *     take it off every page at once, whatever it is attached to. From the
 *     coordinator revision this also covers ERASED bytes: a rendition whose
 *     file a future retention policy has removed carries a purge marker and a
 *     NULL storage key, and is refused here rather than reaching a read that
 *     would fail on a missing file.
 *  2. THE ATTACHMENT STANDS. A detached attachment is history, not placement.
 *  3. A MANAGER PUBLISHED THE ATTACHMENT. This is the draft/publish split:
 *     attaching is drafting and cannot make anything visible.
 *  4. THE OWNER IS ITSELF PUBLIC. An image on an unpublished article is not
 *     public, however published its own attachment is.
 *
 * `CLINIC_SPACE` SATISFIES (4) UNCONDITIONALLY, and the reason is stated rather
 * than implied: there is no owner row to consult, because
 * `clinic_public_profile` is a single row that is always live — editing it IS
 * publishing (Milestone 9, checkpoint A2). Condition (3) therefore carries the
 * whole of the control for clinic-space photographs, and (3) is manager-only.
 * NO PUBLIC PROJECTION IN THIS PRODUCT LISTS ONE, before checkpoint A7 or A8 or
 * after either: the bytes are reachable to somebody holding the rendition id
 * once a manager publishes the attachment, and no page names it.
 *
 * `CLINIC_OPEN_GRAPH` IS THE SECOND OWNERLESS TYPE AND IS THE ONE A8 ADDS ON
 * THAT SIDE (Milestone 9.5, checkpoint A8). It is the site's own social-preview
 * photograph, it hangs off the same always-live `clinic_public_profile`, and it
 * satisfies (4) for the same reason `CLINIC_SPACE` does. UNLIKE `CLINIC_SPACE`,
 * A PUBLIC PROJECTION DOES READ IT: `GET /public/clinic-content` returns it, so
 * a manager publishing the attachment is a manager putting a picture on every
 * link to this site — which is precisely what (3) being manager-only is for.
 *
 * `CLINIC_CONTENT_ENTRY` IS THE OTHER A8 TYPE AND IT HAS A REAL OWNER ROW, so
 * it satisfies (4) conditionally like `PUBLIC_SPACE` — but the condition is not
 * a publication flag, because that table has none. The clinic-content surface
 * is manager-only and editing it IS publishing, so what stands in for "the
 * owner is public" is "the block has been written at all": an entry with no
 * heading appears on no page, and its photograph is refused here. One rule,
 * `heading IS NULL`, read by this predicate and by the public projection, so a
 * manager clearing a heading takes the block AND its picture off the site on
 * the very next request.
 *
 * `PUBLIC_SPACE` IS THE OPPOSITE CASE TO `CLINIC_SPACE`, AND IS THE ONE A7
 * ADDS. It has a real owner row — `public_space`, which a receptionist drafts
 * and a manager publishes — so it satisfies (4) exactly as an article does, and NOT
 * unconditionally. A photograph of the waiting area on an unpublished or
 * withdrawn space is refused here however published its own attachment is, and
 * unpublishing the space revokes every photograph on it at the origin on the
 * very next request. That is what makes "a draft space does not appear
 * publicly" true of its PICTURES and not merely of its words.
 *
 * `PUBLIC_SERVICE` IS THE A9 TYPE AND IT HAS A REAL OWNER ROW, so it satisfies
 * (4) conditionally like `PUBLIC_SPACE` — but its owner gate is THREE
 * CONDITIONS RATHER THAN A FLAG, and stating why is the point of this
 * paragraph. A service is on the website when `is_public` is set AND `status`
 * is `ACTIVE` AND it has a slug; that is what `PublicSiteService.listServices`
 * has required since Milestone 9, checkpoint A1, and this branch requires
 * exactly the same three. Deactivating a service writes `status` ALONE and
 * leaves `is_public` where it was — `ServicesService.setStatus` does not touch
 * the flag — so a branch that read the flag by itself would take the page down
 * and go on handing the photograph to anybody holding the rendition id. One
 * service, one rule, in the projection and here.
 *
 * WHY `EXISTS` PER OWNER RATHER THAN THREE LEFT JOINS. A join whose predicate
 * lives in the `ON` clause is a join somebody can later widen by moving one
 * line into the `WHERE`; a correlated `EXISTS` states "there is a public owner"
 * as one indivisible fact, and a reader checking whether the public site can
 * leak an unpublished photograph has one expression to read.
 */
export const LIVE_ATTACHMENT_PREDICATE = Prisma.sql`
  ma.detached_at IS NULL
  AND ma.published_at IS NOT NULL
  AND CASE ma.owner_type
        WHEN 'THERAPIST_PROFILE' THEN EXISTS (
          SELECT 1 FROM therapist t WHERE t.id = ma.therapist_id AND t.is_public
        )
        WHEN 'PUBLIC_ARTICLE' THEN EXISTS (
          SELECT 1 FROM public_article pa WHERE pa.id = ma.article_id AND pa.is_public
        )
        WHEN 'PUBLIC_TESTIMONIAL' THEN EXISTS (
          SELECT 1 FROM public_testimonial pt WHERE pt.id = ma.testimonial_id AND pt.is_public
        )
        WHEN 'PUBLIC_SPACE' THEN EXISTS (
          SELECT 1 FROM public_space ps WHERE ps.id = ma.space_id AND ps.is_public
        )
        WHEN 'PUBLIC_SERVICE' THEN EXISTS (
          SELECT 1 FROM service svc
          WHERE svc.id = ma.service_id
            AND svc.is_public
            AND svc.status = 'ACTIVE'::catalog_status
            AND svc.public_slug IS NOT NULL
        )
        WHEN 'CLINIC_CONTENT_ENTRY' THEN EXISTS (
          SELECT 1 FROM clinic_content_entry ce
          WHERE ce.id = ma.content_entry_id AND ce.heading IS NOT NULL
        )
        WHEN 'CLINIC_SPACE' THEN TRUE
        WHEN 'CLINIC_OPEN_GRAPH' THEN TRUE
      END
`;

/**
 * The same rule seen from the asset: it is in circulation AND at least one of
 * its attachments is live.
 *
 * `assetAlias` is the alias the caller has given `media_asset` in its own
 * statement. Stated as a function rather than a constant so a caller that
 * aliases the table differently cannot silently correlate against the wrong
 * row.
 */
export function assetIsPubliclyServed(assetAlias: string): Prisma.Sql {
  // `Prisma.raw` interpolates without parameterising, so the one value that
  // reaches it is checked rather than trusted. Every caller passes a literal
  // from this repository today; the guard is here so that a future caller
  // cannot turn a table alias into an injection point without noticing.
  if (!/^[a-z_][a-z0-9_]*$/.test(assetAlias)) {
    throw new Error(`Invalid SQL alias: ${assetAlias}`);
  }

  return Prisma.sql`
    ${Prisma.raw(assetAlias)}.status = 'ACTIVE'
    AND ${Prisma.raw(assetAlias)}.bytes_purged_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM media_attachment ma
      WHERE ma.media_asset_id = ${Prisma.raw(assetAlias)}.id
        AND ${LIVE_ATTACHMENT_PREDICATE}
    )
  `;
}
