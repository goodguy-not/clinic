import { z } from 'zod';
import { publicSlugSchema } from './common';
import { publicImageSchema } from '../media/common';

/**
 * An article as the website states it.
 *
 * Milestone 9, checkpoint A2. This is the second kind of thing the clinic
 * publishes, and unlike a service or a therapist it exists FOR NO OTHER REASON:
 * a service row is clinic configuration that gained a public face, while an
 * article is written to be read by somebody who is not a patient.
 *
 * WHAT IS ABSENT, AND FOR THE REASONS A1 STATED. No `id`: the public identity
 * of an article is its slug. No draft flag, no publication intent, no author,
 * no actor of any kind, no internal timestamp, no revision history. An article
 * a manager is still writing does not appear on this shape because it does not
 * appear in the read that builds it — see `PublicSiteService`.
 *
 * `publishedAt` IS THE ONE TIMESTAMP ON THIS WHOLE SURFACE, and it is here
 * deliberately rather than by omission of the A1 rule. A1 published no
 * timestamp because "when was this service entered" is internal history a
 * visitor is not owed. The date an article was published is the opposite: it is
 * editorial content, a reader judges an article by it, and a page that hides it
 * is hiding something the reader needs. It is the instant of FIRST publication,
 * never a subsequent edit, so an article does not appear to have been written
 * later than it was.
 *
 * `body` IS PLAIN TEXT AND NEVER MARKUP. The database refuses a `<` in any of
 * these three columns, so the web tier can render this value as text — splitting
 * paragraphs on blank lines — without an HTML sanitiser standing between the
 * manager and the visitor. There is no rich-text editor, no block model and no
 * template anywhere in this milestone.
 */
export const publicArticleSummarySchema = z.strictObject({
  slug: publicSlugSchema,
  title: z.string(),
  summary: z.string().nullable(),
  publishedAt: z.iso.datetime(),
  /**
   * The article's published photographs, in the clinic's own order.
   *
   * Milestone 9.5, checkpoint A5. AN ARRAY RATHER THAN A COVER IMAGE, and empty
   * far more often than not. A listing renders the first; a detail page renders
   * them all. Modelling one cover would have made the second article that needs
   * two pictures a schema change.
   *
   * PUBLICATION IS PER IMAGE AND SEPARATE FROM THE ARTICLE'S OWN. An image
   * appears here only when a manager has published its attachment AND the
   * article is public, so a receptionist may prepare the illustrations for a
   * live article without changing the live page — which is the same promise the
   * published-copy columns make about its text.
   */
  images: z.array(publicImageSchema),
});

export type PublicArticleSummary = z.infer<typeof publicArticleSummarySchema>;

/** The detail read adds the article itself, and nothing else. */
export const publicArticleDetailSchema = publicArticleSummarySchema.extend({
  body: z.string(),
});

export type PublicArticleDetail = z.infer<typeof publicArticleDetailSchema>;

export const publicArticleListResponseSchema = z.strictObject({
  articles: z.array(publicArticleSummarySchema),
});

export type PublicArticleListResponse = z.infer<typeof publicArticleListResponseSchema>;

export const publicArticleDetailResponseSchema = z.strictObject({
  article: publicArticleDetailSchema,
});

export type PublicArticleDetailResponse = z.infer<typeof publicArticleDetailResponseSchema>;
