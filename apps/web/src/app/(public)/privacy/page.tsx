import type { Metadata } from 'next';
import { PageHero } from '@/components/public-content';

export const metadata: Metadata = {
  title: 'حریم خصوصی | والا',
  description: 'صفحهٔ اطلاع‌رسانی حریم خصوصی وب‌سایت والا.',
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <main id="main-content">
      <PageHero eyebrow="حریم خصوصی" title="اطلاعاتی که در این سایت می‌دهید" />
      <article className="public-shell b2-legal">
        <aside aria-label="وضعیت متن">
          <span aria-hidden="true">—</span>
          <div>
            <strong>متن نهایی هنوز منتشر نشده است</strong>
            <p>
              این جایگاه عمداً با متن حقوقی نمونه پر نشده است. نسخهٔ نهایی پس از تأیید مالک و مسئول
              حقوقی کلینیک در همین قالب خوانا قرار می‌گیرد.
            </p>
          </div>
        </aside>
        <section aria-labelledby="privacy-structure-title">
          <h2 id="privacy-structure-title">ساختار آمادهٔ انتشار</h2>
          <p>
            صفحه برای عنوان‌ها، بندهای بلند، پیوندهای دسترس‌پذیر و خواندن راحت در موبایل آماده است؛
            اما تا وقتی متن تأییدشده وجود ندارد، ادعایی دربارهٔ جمع‌آوری، استفاده یا نگه‌داری
            اطلاعات بیان نمی‌کند.
          </p>
        </section>
      </article>
    </main>
  );
}
