import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EvaluationCallout, TherapistPhoto, toPersianNumber } from '@/components/public-content';
import { getPublicMetadataContext, getPublicTeam, getPublicTherapist } from '@/server/public-site';
import { privatePublicMetadata, publicMetadata, publicPageTitle } from '@/server/public-seo';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const [read, context] = await Promise.all([getPublicTherapist(slug), getPublicMetadataContext()]);
  if (read.status !== 'ready')
    return privatePublicMetadata(publicPageTitle('تیم درمان', context.clinicName));
  return publicMetadata({
    title: publicPageTitle(read.data.displayName, context.clinicName),
    description:
      read.data.bio ??
      (read.data.title
        ? `${read.data.displayName}، ${read.data.title} در تیم درمان کلینیک.`
        : undefined),
    path: `/team/${read.data.slug}`,
    clinicName: context.clinicName,
    image: read.data.photo ?? context.openGraphImage,
  });
}

export default async function TherapistPage({ params }: Props) {
  const { slug } = await params;
  const [read, team] = await Promise.all([getPublicTherapist(slug), getPublicTeam()]);
  if (read.status === 'not-found') notFound();

  if (read.status === 'unavailable') {
    return (
      <main id="main-content" className="public-shell b2-detail-fallback">
        <p className="public-kicker">تیم درمان</p>
        <h1>نمایش این پروفایل موقتاً ممکن نیست</h1>
        <p>لطفاً کمی بعد دوباره بررسی کنید.</p>
        <Link href="/team" className="public-focus public-text-link">
          بازگشت به تیم درمان
        </Link>
      </main>
    );
  }

  const person = read.data;
  const position = Math.max(
    0,
    team.data.findIndex((item) => item.slug === slug),
  );
  const previous =
    team.data.length > 1
      ? team.data[(position - 1 + team.data.length) % team.data.length]
      : undefined;
  const next = team.data.length > 1 ? team.data[(position + 1) % team.data.length] : undefined;

  return (
    <main id="main-content">
      <article className="public-shell b2-profile">
        <TherapistPhoto photo={person.photo} className="b2-profile__photo" priority />
        <div className="b2-profile__copy">
          <div className="b2-profile__utility">
            <Link href="/team" className="public-focus public-text-link">
              تیم درمان / {person.displayName}
            </Link>
            <span>
              {team.data.length
                ? `${toPersianNumber(position + 1)} از ${toPersianNumber(team.data.length)}`
                : null}
            </span>
          </div>
          <h1>{person.displayName}</h1>
          {person.title ? <p className="b2-profile__title">{person.title}</p> : null}
          <section className="b2-work-areas" aria-labelledby="work-areas-title">
            <h2 id="work-areas-title">حوزه‌های کاری</h2>
            <div>
              <span>{person.title ?? 'اطلاعات تأییدشده هنوز منتشر نشده است'}</span>
            </div>
          </section>
          <section aria-labelledby="bio-title" className="b2-biography">
            <h2 id="bio-title">زندگی‌نامه</h2>
            {person.bio ? (
              <p>{person.bio}</p>
            ) : (
              <p className="b2-muted">زندگی‌نامهٔ عمومی هنوز تکمیل نشده است.</p>
            )}
          </section>
          <section className="b2-profile-relations" aria-label="ارتباط‌های محتوایی">
            <div>
              <small>خدمات مرتبط در کلینیک</small>
              <strong>اطلاعات تأییدشده هنوز منتشر نشده است</strong>
            </div>
            <div>
              <small>خواندنی مرتبط</small>
              <strong>نوشتهٔ مرتبط هنوز منتشر نشده است</strong>
            </div>
          </section>
          <EvaluationCallout title={`دربارهٔ کار با ${person.displayName} سؤال دارید؟`} />
          <p className="b2-provenance-note">
            این پروفایل فقط از نام، عنوان، تصویر و زندگی‌نامهٔ عمومیِ منتشرشده استفاده می‌کند.
          </p>
        </div>
      </article>

      {previous && next ? (
        <nav className="b2-profile-nav" aria-label="پروفایل‌های دیگر تیم درمان">
          <div className="public-shell b2-profile-nav__inner">
            <Link href={`/team/${previous.slug}`} className="public-focus b2-profile-nav__item">
              <TherapistPhoto photo={previous.photo} className="b2-profile-nav__photo" />
              <span aria-hidden="true">→</span>
              <small>پروفایل قبلی</small>
              <strong>{previous.displayName}</strong>
            </Link>
            <Link
              href={`/team/${next.slug}`}
              className="public-focus b2-profile-nav__item b2-profile-nav__item--next"
            >
              <TherapistPhoto photo={next.photo} className="b2-profile-nav__photo" />
              <small>پروفایل بعدی</small>
              <strong>{next.displayName}</strong>
              <span aria-hidden="true">←</span>
            </Link>
          </div>
        </nav>
      ) : null}
    </main>
  );
}
