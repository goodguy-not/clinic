import Image from 'next/image';
import Link from 'next/link';
import type { PublicImage } from '@clinic/contracts';
import type { ReactNode } from 'react';
import { PublicMediaImage } from './public-media-image';

export function PageHero({
  eyebrow,
  title,
  lead,
  children,
  aside,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  children?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="b2-hero">
      <div className="public-shell b2-hero__inner">
        <div className="b2-hero__copy">
          <p className="public-eyebrow">
            <span aria-hidden="true" />
            {eyebrow}
          </p>
          <h1>{title}</h1>
          {lead ? <p className="b2-hero__lead">{lead}</p> : null}
          {children}
        </div>
        {aside ? <div className="b2-hero__aside">{aside}</div> : null}
      </div>
    </header>
  );
}

export function DevelopmentPhoto({
  src,
  alt = '',
  className,
  sizes,
  priority = false,
}: {
  src: string;
  alt?: string;
  className?: string;
  sizes: string;
  priority?: boolean;
}) {
  return (
    <figure className={className}>
      <Image
        src={src}
        fill
        alt={alt}
        sizes={sizes}
        priority={priority}
        loading={priority ? undefined : 'eager'}
      />
      <figcaption className="public-photo-note">
        تصویر نمونهٔ آزمایشی — نه فضای واقعی کلینیک
      </figcaption>
    </figure>
  );
}

export function TherapistPhoto({
  photo,
  className,
  priority = false,
}: {
  photo: PublicImage | null;
  className?: string;
  priority?: boolean;
}) {
  return (
    <figure className={className}>
      {photo !== null ? (
        <PublicMediaImage
          image={photo}
          sizes="(max-width: 48rem) 100vw, 42vw"
          priority={priority}
        />
      ) : (
        <span className="public-media-empty">تصویر عمومی منتشر نشده است</span>
      )}
    </figure>
  );
}

export function ArticlePhoto({
  image,
  className,
  sizes,
  priority = false,
}: {
  image: PublicImage | null;
  className: string;
  sizes: string;
  priority?: boolean;
}) {
  if (image !== null) {
    return (
      <figure className={className}>
        <PublicMediaImage image={image} sizes={sizes} priority={priority} />
      </figure>
    );
  }
  return null;
}

export function PublicPageEmpty({
  unavailable = false,
  title,
  text,
}: {
  unavailable?: boolean;
  title: string;
  text: string;
}) {
  return (
    <div className="b2-empty" role="status">
      <span aria-hidden="true">{unavailable ? '↻' : '—'}</span>
      <div>
        <h2>{unavailable ? 'نمایش اطلاعات موقتاً ممکن نیست' : title}</h2>
        <p>{unavailable ? 'صفحه در دسترس است؛ لطفاً کمی بعد دوباره بررسی کنید.' : text}</p>
      </div>
    </div>
  );
}

export function EvaluationCallout({
  title = 'اگر مطمئن نیستید، بپرسید.',
  serviceSlug,
}: {
  title?: string;
  serviceSlug?: string;
}) {
  const href = serviceSlug ? `/request?service=${encodeURIComponent(serviceSlug)}` : '/request';

  return (
    <aside className="b2-cta" aria-labelledby="b2-cta-title">
      <div>
        <p className="public-kicker public-kicker--gold">درخواست ارزیابی</p>
        <h2 id="b2-cta-title">{title}</h2>
        <p>
          اطلاعات کوتاهی بگذارید؛ کلینیک آن را بررسی می‌کند و برای هماهنگی ارزیابی تماس می‌گیرد.
        </p>
      </div>
      <Link href={href} className="public-focus public-button public-button--gold">
        درخواست ارزیابی
        <span aria-hidden="true">←</span>
      </Link>
    </aside>
  );
}

export function formatPersianDate(value: string) {
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Tehran',
  }).format(new Date(value));
}

export function toPersianNumber(value: number | string) {
  return String(value).replace(/[0-9]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]!);
}
