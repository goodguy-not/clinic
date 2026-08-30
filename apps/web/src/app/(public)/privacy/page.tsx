import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'حریم خصوصی | والا',
  description: 'صفحهٔ اطلاع‌رسانی حریم خصوصی وب‌سایت والا.',
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  const sections = [
    'چه اطلاعاتی جمع می‌شود',
    'این اطلاعات چه استفاده‌ای دارد',
    'چه کسانی دسترسی دارند',
    'نگه‌داری و حذف اطلاعات',
    'راه ارتباط دربارهٔ حریم خصوصی',
  ];

  return (
    <main id="main-content">
      <header className="public-shell b2-legal-hero">
        <p className="public-kicker">حریم خصوصی</p>
        <h1>اطلاعاتی که در این سایت می‌دهید</h1>
        <p>
          این صفحه برای متن حقوقی نهایی آماده است، اما تا زمان تأیید، دربارهٔ شیوهٔ جمع‌آوری یا
          استفاده از اطلاعات ادعایی نمی‌کند.
        </p>
        <small>آخرین به‌روزرسانی: متن نهایی هنوز منتشر نشده است</small>
      </header>
      <article className="public-shell b2-legal">
        <nav aria-label="بخش‌های حریم خصوصی">
          <strong>در این صفحه</strong>
          {sections.map((title, index) => (
            <a key={title} href={`#privacy-${index + 1}`} className="public-focus">
              {title}
            </a>
          ))}
        </nav>
        <div className="b2-legal__content">
          <aside aria-label="وضعیت متن">
            <span aria-hidden="true">—</span>
            <div>
              <strong>متن نهایی هنوز منتشر نشده است</strong>
              <p>نسخهٔ نهایی باید پیش از انتشار توسط مالک و مسئول حقوقی کلینیک تأیید شود.</p>
            </div>
          </aside>
          {sections.map((title, index) => (
            <section key={title} id={`privacy-${index + 1}`}>
              <h2>
                {toPersianIndex(index + 1)} · {title}
              </h2>
              <p>[متن نمونه] محتوای حقوقی تأییدشدهٔ این بخش هنوز منتشر نشده است.</p>
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}

function toPersianIndex(value: number) {
  return String(value).replace(/[0-9]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]!);
}
