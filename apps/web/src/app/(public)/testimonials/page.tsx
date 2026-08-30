import type { Metadata } from 'next';
import {
  EvaluationCallout,
  PageHero,
  PublicPageEmpty,
  toPersianNumber,
} from '@/components/public-content';
import { getPublicTestimonials } from '@/server/public-site';

export const metadata: Metadata = {
  title: 'تجربهٔ خانواده‌ها | والا',
  description: 'روایت‌های ناشناس، تأییدشده و منتشرشدهٔ همراهان والا.',
};

export default async function TestimonialsPage() {
  const testimonials = await getPublicTestimonials();

  return (
    <main id="main-content">
      <PageHero
        eyebrow="تجربهٔ خانواده‌ها"
        title="چند خط از خود خانواده‌ها"
        lead="فقط روایت‌های ناشناس که بررسی، تأیید و برای انتشار انتخاب شده‌اند در این صفحه دیده می‌شوند."
      />
      <section className="public-shell b2-stories" aria-label="روایت‌های منتشرشده">
        {testimonials.data.length ? (
          testimonials.data.map((testimonial, index) => (
            <figure key={`${testimonial.body}-${index}`} className="b2-story-card">
              <span aria-hidden="true">{toPersianNumber(String(index + 1).padStart(2, '0'))}</span>
              <blockquote>«{testimonial.body}»</blockquote>
              {testimonial.authorLabel ? <figcaption>{testimonial.authorLabel}</figcaption> : null}
            </figure>
          ))
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
          این نمایش فعلاً فقط از متن تایپ‌شدهٔ قرارداد عمومی استفاده می‌کند. تصویر دست‌نوشته زمانی
          افزوده می‌شود که مسیر تأییدشدهٔ رسانه و نگه‌داری آن وجود داشته باشد.
        </p>
      </aside>
      <div className="public-shell b2-section-end">
        <EvaluationCallout />
      </div>
    </main>
  );
}
