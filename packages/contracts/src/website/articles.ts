import { z } from 'zod';
import {
  publicHeadingSchema,
  publicProseSchema,
  publicSlugSchema,
  publicSummarySchema,
} from './common';

/**
 * An article as the people who write it see it.
 *
 * Milestone 9, checkpoint A2. This is the INTERNAL shape — drafts included —
 * and it is a different type from `PublicArticleDetail` on purpose, for the
 * reason A1 gave for every public projection: a shape that served both would
 * carry `isPublic` and an internal id to the website the first time somebody
 * rendered it, and would keep carrying whatever this one gained next.
 *
 * THE NARROWEST MODEL THAT TELLS THE TRUTH, AND NOTHING THAT MAKES IT A CMS.
 * Four content fields, one publication flag, three recorded instants. There is
 * no block model, no template, no taxonomy, no tag, no category, no cover
 * image, no author byline, no scheduled publication, no revision table and no
 * co-authoring. Each of those is a product decision nobody has taken, and
 * PROJECT_SPEC.md 11 asks for exactly one thing: a draft/published workflow
 * with authorised publishing and a readable unique URL.
 *
 * PUBLICATION IS ONE FLAG AND NOT A STATUS ENUM. `isPublic` has the same
 * meaning here as on a service and on a therapist — the recorded INTENT to
 * publish — and a `DRAFT | PUBLISHED | ARCHIVED` enum would invent a third
 * state the product has never described. An unpublished article IS the draft.
 *
 * `title`, `summary` AND `body` ON THIS SHAPE ARE THE WORKING DRAFT, NOT WHAT
 * THE WEBSITE SAYS. The two are different values whenever somebody has prepared
 * a change to a live article, and keeping them apart is the whole publication
 * authority: a receptionist may rewrite every word here and the page does not
 * move until a manager publishes. `hasUnpublishedChanges` is how a management
 * screen can say so; the live text itself is read from the public projection,
 * which is the only place it belongs.
 */
export const articleSchema = z.strictObject({
  id: z.uuid(),
  /**
   * The public address, and it is present from creation.
   *
   * A service exists for internal reasons and gains a public identity later,
   * so its slug is nullable. An article exists only to be read, so it has an
   * address from the moment it is written — and, exactly as A1 froze for the
   * catalog, that address may be corrected freely until the first publication
   * makes it a promise, and never afterwards.
   */
  publicSlug: publicSlugSchema,
  /** The working draft. NOT what a visitor is currently reading. */
  title: z.string(),
  summary: z.string().nullable(),
  body: z.string(),
  isPublic: z.boolean(),
  /**
   * The live page is showing something other than the draft above.
   *
   * True only while the article IS public: an unpublished article has no live
   * version for a draft to differ from, and reporting "pending changes" on one
   * would be describing a state that has no consequence. It is a DERIVED fact,
   * computed in the read rather than stored, so it cannot go stale.
   *
   * It carries no diff and names no field. A management screen needs to know
   * that a publication is outstanding; showing WHAT changed is a comparison
   * between this draft and the public read, and inventing a diff format here
   * would be a decision nobody has taken.
   */
  hasUnpublishedChanges: z.boolean(),
  /** Stamped once, by the database, the first time the article was published. */
  firstPublishedAt: z.iso.datetime().nullable(),
  /**
   * When the PUBLISHED content last changed — the sitemap's `lastmod` and
   * nothing else. Null while the article has never been published, because a
   * draft has no published content to have revised.
   */
  publicRevisedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type Article = z.infer<typeof articleSchema>;

/**
 * Creating one ALWAYS creates a draft.
 *
 * There is deliberately no `isPublic` here, and that is an authority decision
 * rather than a convenience: creating is `article.draft`, which a receptionist
 * holds, and publishing is `article.publish`, which only a manager holds. A
 * creation request carrying a publication flag would let the lower authority
 * perform the higher act in one round trip.
 *
 * NO ADDRESS (M10-A10, T-010). Nobody types a public address: the database
 * assigns one when the row is created, it never changes, and it is read back on
 * the response. A request carrying `publicSlug` is refused as a field this
 * shape does not have.
 */
export const createArticleRequestSchema = z.strictObject({
  title: publicHeadingSchema,
  summary: publicSummarySchema.nullable(),
  body: publicProseSchema,
});

export type CreateArticleRequest = z.infer<typeof createArticleRequestSchema>;

/**
 * Editing carries no publication flag either, for the same reason, and no
 * address: the one assigned at creation is the article's for good.
 */
export const updateArticleRequestSchema = createArticleRequestSchema;

export type UpdateArticleRequest = z.infer<typeof updateArticleRequestSchema>;

/**
 * Publishing and withdrawing, as one authority and two audited facts.
 *
 * One route with a boolean rather than `/publish` and `/unpublish`: it is one
 * decision — whether what this article currently says goes on the website — and
 * the manager surface that carries it is one control. The audit records the two
 * directions separately, because "how often is something withdrawn?" is a
 * question a JSON diff cannot be counted for.
 *
 * `isPublic: true` IS ALSO THE APPROVAL OF A PENDING CHANGE, and it is the same
 * act rather than a second one: publishing an article means "what the draft now
 * says is what the website says", whether the page was empty before or was
 * showing an earlier version. A separate `approve` route beside this one would
 * be two names for one decision, and a manager would have to know which of them
 * a given article needed.
 */
export const updateArticlePublicationRequestSchema = z.strictObject({
  isPublic: z.boolean(),
});

export type UpdateArticlePublicationRequest = z.infer<typeof updateArticlePublicationRequestSchema>;

export const articleResponseSchema = z.strictObject({ article: articleSchema });

export type ArticleResponse = z.infer<typeof articleResponseSchema>;

export const articleListResponseSchema = z.strictObject({ articles: z.array(articleSchema) });

export type ArticleListResponse = z.infer<typeof articleListResponseSchema>;
