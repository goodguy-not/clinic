import type { Metadata } from 'next';
import { EvaluationCallout, PageHero, PublicPageEmpty } from '@/components/public-content';
import { PublicTestimonialGrid } from '@/components/public-testimonial-grid';
import { getPublicMetadataContext, getPublicTestimonials } from '@/server/public-site';
import { publicMetadata, publicPageTitle } from '@/server/public-seo';

export async function generateMetadata(): Promise<Metadata> {
  const { clinicName, openGraphImage } = await getPublicMetadataContext();
  return publicMetadata({
    title: publicPageTitle('تجربهٔ خانواده‌ها', clinicName),
    description: 'روایت‌های ناشناس، تأییدشده و منتشرشدهٔ همراهان کلینیک.',
    path: '/testimonials',
    clinicName,
    image: openGraphImage,
  });
}

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
            showDevelopmentExamples={
              testimonials.data.length === 0 && process.env.NODE_ENV !== 'production'
            }
          />
        ) : (
          <PublicPageEmpty
            unavailable={testimonials.status === 'unavailable'}
            title="روایتی برای نمایش منتشر نشده است"
            text="این صفحه تا زمان انتشار روایت‌های تأییدشده، نقل‌قول ساختگی نمایش نمی‌دهد."
          />
        )}
      </section>
      {testimonials.data.length === 0 && process.env.NODE_ENV !== 'production' ? (
        <aside className="public-shell b2-disclosure">
          <strong>دربارهٔ انتشار</strong>
          <p>کارت‌های دارای برچسب «نمونهٔ توسعه» روایت واقعی نیستند.</p>
        </aside>
      ) : null}
      <div className="public-shell b2-section-end">
        <EvaluationCallout />
      </div>
    </main>
  );
}
