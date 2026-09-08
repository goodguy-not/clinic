import type { PublicImage } from '@clinic/contracts';
import { cropImageStyle } from '@/media/framing';

function srcSet(image: PublicImage, format: 'webp' | 'jpeg'): string {
  return image.renditions
    .filter((rendition) => rendition.format === format)
    .map((rendition) => `/${rendition.path} ${rendition.width}w`)
    .join(', ');
}

/** Responsive A5 photograph, framed at the attachment rather than the asset. */
export function PublicMediaImage({
  image,
  sizes,
  priority = false,
}: {
  image: PublicImage;
  sizes: string;
  priority?: boolean;
}) {
  const jpeg = image.renditions.filter((rendition) => rendition.format === 'jpeg');
  const fallback = jpeg.at(-1) ?? image.renditions.at(-1);
  if (fallback === undefined) return null;

  return (
    <span className="absolute inset-0 block overflow-hidden">
      <picture>
        <source type="image/webp" srcSet={srcSet(image, 'webp')} sizes={sizes} />
        {/* The response is same-origin and already sanitised by A5. */}
        <img
          src={`/${fallback.path}`}
          srcSet={srcSet(image, 'jpeg')}
          sizes={sizes}
          width={image.width}
          height={image.height}
          alt={image.alt}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          style={cropImageStyle(image.framing)}
        />
      </picture>
    </span>
  );
}
