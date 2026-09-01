import type { Metadata } from 'next';
import { DevelopmentPhoto, EvaluationCallout, PageHero } from '@/components/public-content';
import { PublicSpaceTeaser } from '@/components/public-space-teaser';
import { getPublicClinicProfile } from '@/server/public-site';
import { publicMetadata } from '@/server/public-seo';

export const metadata: Metadata = publicMetadata({
  title: 'دربارهٔ والا و فضاها | والا',
  description: 'معرفی عمومی منتشرشدهٔ کلینیک توانبخشی والا و راهنمای پیش از مراجعه.',
  path: '/about',
});

export default async function AboutPage() {
  const clinic = await getPublicClinicProfile();

  return (
    <main id="main-content">
      <PageHero
        eyebrow="دربارهٔ والا"
        title="والا چه جور جایی است؟"
        aside={
          <nav className="b2-page-index" aria-label="در این صفحه">
            <strong>در این صفحه</strong>
            <a href="#character" className="public-focus">
              <span>شخصیت والا</span>
            </a>
            <a href="#spaces" className="public-focus">
              <span>فضاهای والا</span>
            </a>
            <a href="#why-space" className="public-focus">
              <span>چرا فضا این‌طور طراحی شده</span>
            </a>
            <a href="#first-visit" className="public-focus">
              <span>اولین برخورد با والا</span>
            </a>
          </nav>
        }
      >
        {clinic.data.tagline ? <p className="b2-hero__lead">{clinic.data.tagline}</p> : null}
      </PageHero>

      <section
        id="character"
        className="public-shell b2-fact-rule b2-about-facts"
        aria-label="شخصیت والا"
      >
        <div>
          <small>مسیر روشن</small>
          <strong>توضیح تأییدشدهٔ این ویژگی هنوز منتشر نشده است</strong>
        </div>
        <div>
          <small>توضیح به زبان ساده</small>
          <strong>توضیح تأییدشدهٔ این ویژگی هنوز منتشر نشده است</strong>
        </div>
        <div>
          <small>همراهی خانواده</small>
          <strong>توضیح تأییدشدهٔ این ویژگی هنوز منتشر نشده است</strong>
        </div>
      </section>

      <section className="b2-about-intro" aria-labelledby="about-intro-title">
        <DevelopmentPhoto
          src="/dev/vala-synthetic/01-reception.jpg"
          className="b2-about-intro__photo"
          sizes="100vw"
          priority
        />
        <div className="public-shell b2-about-intro__copy">
          <p className="public-kicker public-kicker--gold">والا به روایت خودش</p>
          <h2 id="about-intro-title">پیش از آمدن، کمی آشناتر شوید</h2>
          {clinic.data.about ? (
            <p>{clinic.data.about}</p>
          ) : (
            <p>معرفی تأییدشدهٔ کلینیک هنوز تکمیل نشده است.</p>
          )}
        </div>
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

      <section
        id="why-space"
        className="public-shell b2-space-rationale"
        aria-labelledby="space-rationale-title"
      >
        <div>
          <p className="public-kicker">چرا فضا این‌طور طراحی شده</p>
          <h2 id="space-rationale-title">جزئیات واقعی، پس از تأیید فضا</h2>
          <p>
            این بخش برای توضیح تجربهٔ ورود، دسترسی و مسیر حرکت آماده است؛ متن فعلی هیچ ویژگی واقعی
            را به کلینیک نسبت نمی‌دهد.
          </p>
          <ul className="b2-hairline-list">
            <li>اطلاعات تأییدشدهٔ دسترسی هنوز منتشر نشده است.</li>
            <li>اطلاعات تأییدشدهٔ مسیر ورود هنوز منتشر نشده است.</li>
            <li>اطلاعات تأییدشدهٔ امکانات همراهان هنوز منتشر نشده است.</li>
          </ul>
        </div>
        <DevelopmentPhoto
          src="/dev/vala-synthetic/05-corridor.jpg"
          className="b2-space-rationale__photo"
          sizes="(max-width: 56rem) 100vw, 42vw"
        />
      </section>

      <section id="first-visit" className="b2-first-visit" aria-labelledby="first-visit-title">
        <div className="public-shell">
          <p className="public-kicker">اولین برخورد با والا</p>
          <h2 id="first-visit-title">از درخواست تا ارزیابی</h2>
          <div className="b2-first-visit__steps">
            {['درخواست', 'بررسی', 'هماهنگی'].map((label, index) => (
              <div key={label}>
                <span>{index + 1}</span>
                <strong>{label}</strong>
                <p>جزئیات تأییدشدهٔ این مرحله در B3 تکمیل می‌شود.</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <div className="public-shell b2-section-end">
        <EvaluationCallout title="می‌خواهید دربارهٔ آمدن به والا بپرسید؟" />
      </div>
    </main>
  );
}
