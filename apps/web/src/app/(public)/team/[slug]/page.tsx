import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  EvaluationCallout,
  THERAPIST_IMAGES,
  TherapistPhoto,
  toPersianNumber,
} from '@/components/public-content';
import { getPublicTeam, getPublicTherapist } from '@/server/public-site';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const read = await getPublicTherapist(slug);
  if (read.status !== 'ready') return { title: 'تیم درمان | والا', robots: { index: false } };
  return { title: `${read.data.displayName} | والا`, description: read.data.bio ?? undefined };
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
        <TherapistPhoto
          photoPath={person.photoPath}
          fallback={THERAPIST_IMAGES[position % THERAPIST_IMAGES.length]!}
          name={person.displayName}
          className="b2-profile__photo"
          priority
        />
        <div className="b2-profile__copy">
          <Link href="/team" className="public-focus public-text-link">
            همهٔ تیم درمان
          </Link>
          <p className="public-eyebrow">
            <span aria-hidden="true" />
            پروفایل عمومی
          </p>
          <h1>{person.displayName}</h1>
          {person.title ? <p className="b2-profile__title">{person.title}</p> : null}
          <section aria-labelledby="bio-title" className="b2-biography">
            <h2 id="bio-title">معرفی</h2>
            {person.bio ? (
              <p>{person.bio}</p>
            ) : (
              <p className="b2-muted">زندگی‌نامهٔ عمومی هنوز تکمیل نشده است.</p>
            )}
          </section>
          <p className="b2-profile__position">
            {team.data.length
              ? `${toPersianNumber(position + 1)} از ${toPersianNumber(team.data.length)}`
              : null}
          </p>
        </div>
      </article>

      {previous && next ? (
        <nav className="b2-profile-nav" aria-label="پروفایل‌های دیگر تیم درمان">
          <div className="public-shell b2-profile-nav__inner">
            <Link href={`/team/${previous.slug}`} className="public-focus b2-profile-nav__item">
              <span aria-hidden="true">→</span>
              <small>پروفایل قبلی</small>
              <strong>{previous.displayName}</strong>
            </Link>
            <Link
              href={`/team/${next.slug}`}
              className="public-focus b2-profile-nav__item b2-profile-nav__item--next"
            >
              <small>پروفایل بعدی</small>
              <strong>{next.displayName}</strong>
              <span aria-hidden="true">←</span>
            </Link>
          </div>
        </nav>
      ) : null}
      <div className="public-shell b2-section-end">
        <EvaluationCallout />
      </div>
    </main>
  );
}
