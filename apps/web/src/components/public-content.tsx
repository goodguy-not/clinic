import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';

export const SERVICE_IMAGES = [
  '/dev/vala-synthetic/12-therapist-child-interaction.jpg',
  '/dev/vala-synthetic/13-hand-therapy-detail.jpg',
  '/dev/vala-synthetic/11-balance-therapy.jpg',
  '/dev/vala-synthetic/03-pediatric-room.jpg',
  '/dev/vala-synthetic/02-rehab-gym.jpg',
  '/dev/vala-synthetic/04-treatment-room.jpg',
] as const;

export const THERAPIST_IMAGES = [
  '/dev/vala-synthetic/08-therapist-portrait-b.jpg',
  '/dev/vala-synthetic/07-therapist-portrait-a.jpg',
  '/dev/vala-synthetic/10-therapist-portrait-d.jpg',
  '/dev/vala-synthetic/09-therapist-portrait-c.jpg',
] as const;

export function PageHero({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  children?: ReactNode;
}) {
  return (
    <header className="b2-hero">
      <div className="public-shell b2-hero__inner">
        <p className="public-eyebrow">
          <span aria-hidden="true" />
          {eyebrow}
        </p>
        <h1>{title}</h1>
        {lead ? <p className="b2-hero__lead">{lead}</p> : null}
        {children}
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
        تصویر نمونهٔ آزمایشی — نه فضای واقعی والا
      </figcaption>
    </figure>
  );
}

export function TherapistPhoto({
  photoPath,
  fallback,
  name,
  className,
  priority = false,
}: {
  photoPath: string | null;
  fallback: string;
  name: string;
  className?: string;
  priority?: boolean;
}) {
  return (
    <figure className={className}>
      {photoPath ? (
        // Public media paths are already constrained to same-site relative paths by A1.
        // A plain image keeps the rendering independent of a storage provider.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/${photoPath}`} alt={name} loading={priority ? 'eager' : 'lazy'} />
      ) : (
        <Image
          src={fallback}
          fill
          alt=""
          sizes="(max-width: 48rem) 100vw, 42vw"
          priority={priority}
        />
      )}
      {!photoPath ? (
        <figcaption className="public-photo-note">
          تصویر نمونهٔ آزمایشی — این درمانگر نیست
        </figcaption>
      ) : null}
    </figure>
  );
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
  const href = serviceSlug
    ? `/contact?service=${encodeURIComponent(serviceSlug)}#request`
    : '/contact#request';

  return (
    <aside className="b2-cta" aria-labelledby="b2-cta-title">
      <div>
        <p className="public-kicker public-kicker--gold">درخواست ارزیابی</p>
        <h2 id="b2-cta-title">{title}</h2>
        <p>
          اطلاعات کوتاهی بگذارید؛ تیم والا آن را بررسی می‌کند و برای هماهنگی ارزیابی تماس می‌گیرد.
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
