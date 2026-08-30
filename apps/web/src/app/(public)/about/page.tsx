import type { Metadata } from 'next';
import { DevelopmentPhoto, EvaluationCallout, PageHero } from '@/components/public-content';
import { PublicSpaceTeaser } from '@/components/public-space-teaser';
import { getPublicClinicProfile } from '@/server/public-site';

export const metadata: Metadata = {
  title: 'دربارهٔ والا و فضاها | والا',
  description: 'آشنایی با کلینیک توانبخشی والا و تجربهٔ تصویری فضاها.',
};

export default async function AboutPage() {
  const clinic = await getPublicClinicProfile();

  return (
    <main id="main-content">
      <PageHero eyebrow="دربارهٔ والا" title="جایی برای فهمیدن و قدم بعدی">
        {clinic.data.tagline ? <p className="b2-hero__lead">{clinic.data.tagline}</p> : null}
      </PageHero>

      <section className="public-shell b2-about-intro" aria-labelledby="about-intro-title">
        <div>
          <p className="public-kicker">والا به روایت خودش</p>
          <h2 id="about-intro-title">پیش از آمدن، کمی آشناتر شوید</h2>
          {clinic.data.about ? (
            <p>{clinic.data.about}</p>
          ) : (
            <p className="b2-muted">معرفی تأییدشدهٔ کلینیک هنوز تکمیل نشده است.</p>
          )}
        </div>
        <DevelopmentPhoto
          src="/dev/vala-synthetic/01-reception.jpg"
          className="b2-about-intro__photo"
          sizes="(max-width: 56rem) 100vw, 44vw"
          priority
        />
      </section>

      <section id="spaces" className="b2-spaces-full" aria-labelledby="spaces-title">
        <div className="public-shell b2-spaces-full__heading">
          <div>
            <p className="public-kicker">فضاهای والا</p>
            <h2 id="spaces-title">یک نگاه، پیش از اولین مراجعه</h2>
          </div>
          <p>
            این تجربهٔ تعاملی برای جای‌گیری عکس‌های تأییدشده آماده است. تصاویر فعلی فقط مرجع
            توسعه‌اند و هیچ فضای واقعی را معرفی نمی‌کنند.
          </p>
        </div>
        <PublicSpaceTeaser full />
      </section>
      <div className="public-shell b2-section-end">
        <EvaluationCallout title="می‌خواهید دربارهٔ آمدن به والا بپرسید؟" />
      </div>
    </main>
  );
}
