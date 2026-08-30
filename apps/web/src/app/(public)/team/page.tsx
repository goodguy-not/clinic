import type { Metadata } from 'next';
import Link from 'next/link';
import {
  EvaluationCallout,
  PageHero,
  PublicPageEmpty,
  THERAPIST_IMAGES,
  TherapistPhoto,
  toPersianNumber,
} from '@/components/public-content';
import { getPublicTeam } from '@/server/public-site';

export const metadata: Metadata = {
  title: 'تیم درمان | والا',
  description: 'پروفایل‌های عمومی و با رضایت تیم درمان کلینیک توانبخشی والا.',
};

export default async function TeamPage() {
  const team = await getPublicTeam();

  return (
    <main id="main-content">
      <PageHero
        eyebrow="تیم درمان"
        title="آدم‌هایی که در مسیر کنار شما هستند"
        lead="در این صفحه فقط همکارانی دیده می‌شوند که پروفایل عمومی‌شان با رضایت و محتوای تأییدشده منتشر شده است."
      />
      <section className="public-shell b2-team-list" aria-label="درمانگران عمومی والا">
        {team.data.length ? (
          team.data.map((person, index) => (
            <Link
              key={person.slug}
              href={`/team/${person.slug}`}
              className="public-focus b2-team-row"
            >
              <TherapistPhoto
                photoPath={person.photoPath}
                fallback={THERAPIST_IMAGES[index % THERAPIST_IMAGES.length]!}
                name={person.displayName}
                className="b2-team-row__photo"
                priority={index === 0}
              />
              <div className="b2-team-row__copy">
                <span>{toPersianNumber(String(index + 1).padStart(2, '0'))}</span>
                <h2>{person.displayName}</h2>
                {person.title ? <p className="b2-team-row__title">{person.title}</p> : null}
                {person.bio ? (
                  <p>{person.bio}</p>
                ) : (
                  <p className="b2-muted">معرفی عمومی هنوز تکمیل نشده است.</p>
                )}
                <strong>
                  دیدن پروفایل <span aria-hidden="true">←</span>
                </strong>
              </div>
            </Link>
          ))
        ) : (
          <PublicPageEmpty
            unavailable={team.status === 'unavailable'}
            title="پروفایل عمومی تیم هنوز منتشر نشده است"
            text="با تأیید و رضایت همکاران، معرفی آن‌ها در همین صفحه دیده می‌شود."
          />
        )}
      </section>
      <div className="public-shell b2-section-end">
        <EvaluationCallout />
      </div>
    </main>
  );
}
