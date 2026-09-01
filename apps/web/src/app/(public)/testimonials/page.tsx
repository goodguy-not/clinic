import type { Metadata } from 'next';
import { EvaluationCallout, PageHero, PublicPageEmpty } from '@/components/public-content';
import { PublicTestimonialGrid } from '@/components/public-testimonial-grid';
import { getPublicTestimonials } from '@/server/public-site';
import { publicMetadata } from '@/server/public-seo';

export const metadata: Metadata = publicMetadata({
  title: 'تجربهٔ خانواده‌ها | والا',
  description: 'روایت‌های ناشناس، تأییدشده و منتشرشدهٔ همراهان والا.',
  path: '/testimonials',
});

export default async function TestimonialsPage() {
  const testimonials = await getPublicTestimonials();

  return (
    <main id="main-content">
      <PageHero
        eyebrow="تجربهٔ خانواده‌ها"
        title="چند خط از خود خانواده‌ها"
        lead="فقط روایت‌های ناشناس که بررسی، تأیید و برای انتشار انتخاب شده‌اند در این صفحه دیده می‌شوند."
        aside={
          <div className="b2-publication-note">
            <strong>دربارهٔ انتشار</strong>
            <p>بدون نام کامل؛ فقط پس از رضایت و تأیید انتشار.</p>
          </div>
        }
      />
      <section className="public-shell b2-stories" aria-label="روایت‌های منتشرشده">
        {testimonials.data.length || process.env.NODE_ENV !== 'production' ? (
          <PublicTestimonialGrid
            testimonials={testimonials.data}
            showDevelopmentExamples={process.env.NODE_ENV !== 'production'}
          />
        ) : (
          <PublicPageEmpty
            unavailable={testimonials.status === 'unavailable'}
            title="روایتی برای نمایش منتشر نشده است"
            text="این صفحه تا زمان انتشار روایت‌های تأییدشده، نقل‌قول ساختگی نمایش نمی‌دهد."
          />
        )}
      </section>
      <aside className="public-shell b2-disclosure">
        <strong>دربارهٔ انتشار</strong>
        <p>
          کارت‌های دارای برچسب «نمونهٔ توسعه» روایت واقعی نیستند و فقط رفتار دست‌نوشته/رونویسی را
          نشان می‌دهند. دادهٔ عمومی فعلی فقط متن تایپ‌شده دارد.
        </p>
      </aside>
      <div className="public-shell b2-section-end">
        <EvaluationCallout />
      </div>
    </main>
  );
}
