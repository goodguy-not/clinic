import 'server-only';
import { revalidateTag } from 'next/cache';
import {
  PUBLIC_ARTICLE_CACHE_TAG_PREFIX,
  PUBLIC_CACHE_TAGS,
  type Article,
} from '@clinic/contracts';

/** Drops only the accepted public projections after a successful content write. */
export function revalidateArticle(article: Article): void {
  revalidateTag(PUBLIC_CACHE_TAGS.articles, { expire: 0 });
  revalidateTag(`${PUBLIC_ARTICLE_CACHE_TAG_PREFIX}${article.publicSlug}`, { expire: 0 });
  revalidateTag(PUBLIC_CACHE_TAGS.sitemap, { expire: 0 });
}

export function revalidateTestimonials(): void {
  revalidateTag(PUBLIC_CACHE_TAGS.testimonials, { expire: 0 });
}
