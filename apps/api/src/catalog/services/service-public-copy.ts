import { Prisma } from '@prisma/client';

/**
 * THE ONLY TWO STATEMENTS IN THIS APPLICATION THAT WRITE
 * `service.published_public_description`.
 *
 * Milestone 9.5, checkpoint A6. The column is what the website says about a
 * service; `public_description` beside it is the working draft, which a manager
 * on the service form and a receptionist on the editorial surface may both
 * rewrite at any time. Keeping the two writers here, in one file with no other
 * contents, is what makes "who can move a live page?" a question a reader can
 * answer by looking at the callers of two functions rather than by grepping for
 * a column name.
 *
 * There are TWO callers of `promote`, and they are one decision seen at two
 * moments. `ServicesService.update` calls it when a service becomes publicly
 * reachable — the manager ticking the public box IS the decision that what is
 * prepared should be seen, exactly as `article.setPublication(true)` is — and
 * `ServicePublicCopyService.setPublication` calls it afterwards, when a change
 * has been prepared for a service that is already live. One statement, so the
 * two moments cannot drift into two meanings.
 *
 * NEITHER FUNCTION TAKES THE TEXT. Both read the draft column in the same
 * statement that writes the published one, so no caller can publish something
 * other than what is prepared, and no caller can publish text that never passed
 * through the draft.
 */

/**
 * `public_revised_at` IS STAMPED ONLY WHILE THE SERVICE IS REACHABLE, because
 * it is the sitemap's last-modified and a private service has no published page
 * for this write to have revised. `transaction_timestamp()` rather than a value
 * from Node, so this instant and the `occurred_at` of the audit row beside it
 * are provably the same one.
 */
const STAMP_IF_REACHABLE = Prisma.sql`
  public_revised_at = CASE
    WHEN is_public AND public_slug IS NOT NULL THEN transaction_timestamp()
    ELSE public_revised_at
  END
`;

/** What the draft now says is what the website says. */
export async function promoteServicePublicCopy(
  tx: Prisma.TransactionClient,
  serviceId: string,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE service
    SET published_public_description = public_description,
        ${STAMP_IF_REACHABLE}
    WHERE id = ${serviceId}::uuid
  `;
}

/**
 * The website stops saying it, and the service stays listed.
 *
 * The proportionate remedy for a published sentence that turned out to be
 * wrong: the alternative is taking the whole service off the site, which is a
 * different and much larger decision and lives on a different route. THE DRAFT
 * IS LEFT WHERE IT IS, so the copy can be corrected and published again rather
 * than rewritten from nothing.
 */
export async function withdrawServicePublicCopy(
  tx: Prisma.TransactionClient,
  serviceId: string,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE service
    SET published_public_description = NULL,
        ${STAMP_IF_REACHABLE}
    WHERE id = ${serviceId}::uuid
  `;
}
