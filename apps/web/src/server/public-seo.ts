import 'server-only';
import type { Metadata } from 'next';
import type { PublicImage } from '@clinic/contracts';
import { publicSiteOrigin } from '@/env';

const MAX_DESCRIPTION_CHARACTERS = 160;

type PublicMetadataInput = {
  title: string;
  description?: string | null;
  path: `/${string}` | '/';
  clinicName: string | null;
  image?: PublicImage | null;
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

/** A page title that never invents a clinic identity when the managed name is absent. */
export function publicPageTitle(page: string | null, clinicName: string | null): string {
  return [page, clinicName].filter((part): part is string => Boolean(part?.trim())).join(' | ');
}

function publicMetadataImage(image: PublicImage | null | undefined, origin: string) {
  if (image == null) return undefined;
  const rendition =
    image.renditions.filter((candidate) => candidate.format === 'jpeg').at(-1) ??
    image.renditions.at(-1);
  if (rendition === undefined) return undefined;

  return [
    {
      url: absolutePublicUrl(`/${rendition.path}`, origin),
      width: rendition.width,
      height: rendition.height,
      alt: image.alt,
    },
  ];
}

/** Shared, truthful metadata for an indexable public document. */
export function publicMetadata(
  {
    title,
    description,
    path,
    clinicName,
    image,
    kind = 'website',
    publishedTime,
  }: PublicMetadataInput,
  origin = publicSiteOrigin(),
): Metadata {
  const url = absolutePublicUrl(path, origin);
  const summary = metadataDescription(description);
  const images = publicMetadataImage(image, origin);
  const common = {
    locale: 'fa_IR' as const,
    ...(clinicName === null ? {} : { siteName: clinicName }),
    title,
    description: summary,
    url,
    ...(images === undefined ? {} : { images }),
  };

  return {
    title,
    description: summary,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph:
      kind === 'article'
        ? {
            type: 'article',
            ...common,
            publishedTime,
          }
        : {
            type: 'website',
            ...common,
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
