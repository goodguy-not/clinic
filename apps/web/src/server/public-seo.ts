import 'server-only';
import type { Metadata } from 'next';
import { publicSiteOrigin } from '@/env';

const SITE_NAME = 'کلینیک توانبخشی والا';
const DEFAULT_OG_IMAGE_PATH = '/icon.png';
const MAX_DESCRIPTION_CHARACTERS = 160;

type PublicMetadataInput = {
  title: string;
  description?: string | null;
  path: `/${string}` | '/';
  kind?: 'website' | 'article';
  publishedTime?: string;
};

export function absolutePublicUrl(path: `/${string}` | '/', origin = publicSiteOrigin()): string {
  return new URL(path, `${origin}/`).toString();
}

export function metadataDescription(value?: string | null): string | undefined {
  const compact = value?.replace(/\s+/g, ' ').trim();
  if (!compact) return undefined;
  const characters = Array.from(compact);
  if (characters.length <= MAX_DESCRIPTION_CHARACTERS) return compact;
  return `${characters
    .slice(0, MAX_DESCRIPTION_CHARACTERS - 1)
    .join('')
    .trimEnd()}…`;
}

/** Shared, truthful metadata for an indexable public document. */
export function publicMetadata(
  { title, description, path, kind = 'website', publishedTime }: PublicMetadataInput,
  origin = publicSiteOrigin(),
): Metadata {
  const url = absolutePublicUrl(path, origin);
  const summary = metadataDescription(description);
  const imageUrl = absolutePublicUrl(DEFAULT_OG_IMAGE_PATH, origin);

  return {
    title,
    description: summary,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph:
      kind === 'article'
        ? {
            type: 'article',
            locale: 'fa_IR',
            siteName: SITE_NAME,
            title,
            description: summary,
            url,
            publishedTime,
            images: [{ url: imageUrl, width: 512, height: 512, alt: 'نشان والا' }],
          }
        : {
            type: 'website',
            locale: 'fa_IR',
            siteName: SITE_NAME,
            title,
            description: summary,
            url,
            images: [{ url: imageUrl, width: 512, height: 512, alt: 'نشان والا' }],
          },
  };
}

/** A neutral result for unavailable or non-public detail reads. */
export function privatePublicMetadata(title: string): Metadata {
  return {
    title,
    robots: { index: false, follow: false, nocache: true },
  };
}
