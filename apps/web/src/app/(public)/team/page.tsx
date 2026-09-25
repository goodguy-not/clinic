import type { Metadata } from 'next';
import Link from 'next/link';
import {
  EvaluationCallout,
  PageHero,
  PublicPageEmpty,
  TherapistPhoto,
  toPersianNumber,
} from '@/components/public-content';
import { getPublicMetadataContext, getPublicTeam } from '@/server/public-site';
import { publicMetadata, publicPageTitle } from '@/server/public-seo';

export async function generateMetadata(): Promise<Metadata> {
  const { clinicName, openGraphImage } = await getPublicMetadataContext();
  return publicMetadata({
    title: publicPageTitle('تیم درمان', clinicName),
    description: 'پروفایل‌های عمومی و با رضایت تیم درمان کلینیک.',
    path: '/team',
    clinicName,
    image: openGraphImage,
  });
}

export default async function TeamPage() {
  const team = await getPublicTeam();

  return (
    <main id="main-content">
      <PageHero
        eyebrow="تیم درمان"
        title="با چه کسی کار می‌کنید؟"
        lead="در این صفحه فقط همکارانی دیده می‌شوند که پروفایل عمومی‌شان با رضایت و محتوای تأییدشده منتشر شده است."
        aside={
          <div className="b2-count-note">
            <strong>{toPersianNumber(team.data.length)}</strong>
            <p>پروفایل عمومی منتشرشده؛ انتخاب درمانگر پس از درخواست ارزیابی با تیم مرور می‌شود.</p>
          </div>
        }
      />
      <section className="public-shell b2-team-list" aria-labelledby="team-group-title">
        <header className="b2-team-group-heading">
          <div>
            <h2 id="team-group-title">تیم درمان</h2>
            <span>{toPersianNumber(team.data.length)} درمانگر</span>
          </div>
          <p>دادهٔ تأییدشدهٔ حوزه‌بندی تخصصی هنوز در قرارداد عمومی سایت وجود ندارد.</p>
        </header>
        {team.data.length ? (
          team.data.map((person, index) => (
            <Link
              key={person.slug}
              href={`/team/${person.slug}`}
              className="public-focus b2-team-row"
            >
              <TherapistPhoto
                photo={person.photo}
                className="b2-team-row__photo"
                sizes="96px"
                priority={index === 0}
              />
              <div className="b2-team-row__copy">
                <span>{toPersianNumber(String(index + 1).padStart(2, '0'))}</span>
                <h2>{person.displayName}</h2>
                {person.title ? <p className="b2-team-row__title">{person.title}</p> : null}
                <div className="b2-team-row__areas" aria-label="حوزه‌های کاری">
                  <span>{person.title ?? 'حوزهٔ کاری تأییدشده هنوز منتشر نشده است'}</span>
                </div>
                <strong>
                  پروفایل درمانگر <span aria-hidden="true">←</span>
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
