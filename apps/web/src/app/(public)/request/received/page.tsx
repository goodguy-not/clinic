import type { Metadata } from 'next';
import Link from 'next/link';
import { getPublicClinicProfile } from '@/server/public-site';

export const metadata: Metadata = {
  title: 'درخواست شما ثبت شد | والا',
  robots: { index: false, follow: false, nocache: true },
};

export default async function RequestReceivedPage() {
  const { data: clinic } = await getPublicClinicProfile();

  return (
    <main id="main-content" className="request-received">
      <section className="request-received__hero">
        <div className="public-shell">
          <span className="request-received__check" aria-hidden="true">
            ✓
          </span>
          <p className="public-kicker public-kicker--gold">درخواست ارزیابی</p>
          <h1>درخواست شما ثبت شد</h1>
          <p>
            اطلاعاتی که فرستادید در والا ثبت شده است. تیم آن را بررسی می‌کند و کلینیک برای هماهنگی
            قدم بعدی با شما تماس می‌گیرد. این ثبت به معنی رزرو یا تأیید نوبت نیست.
          </p>
        </div>
      </section>

      <section className="public-shell request-received__body">
        <div className="request-received__steps">
          <h2>از اینجا به بعد</h2>
          <ol>
            <li>
              <span>۱</span>
              <p>اطلاعات ثبت شده است.</p>
            </li>
            <li>
              <span>۲</span>
              <p>تیم والا آن را مرور می‌کند.</p>
            </li>
            <li>
              <span>۳</span>
              <p>کلینیک برای هماهنگی قدم بعدی تماس می‌گیرد.</p>
            </li>
          </ol>
        </div>
        <div className="request-received__links">
          <h2>در این فاصله، اگر دوست دارید</h2>
          <Link href="/about#spaces" className="public-focus">
            <strong>فضاهای والا را ببینید</strong>
            <span>پیش از مراجعه با محیط آشنا شوید ←</span>
          </Link>
          <Link href="/articles" className="public-focus">
            <strong>خواندنی‌های خانواده‌ها</strong>
            <span>نوشته‌های منتشرشده را بخوانید ←</span>
          </Link>
          {clinic.phonePrimary ? (
            <p>
              اگر سؤال دیگری دارید، می‌توانید با کلینیک تماس بگیرید:{' '}
              <a href={`tel:${clinic.phonePrimary}`} className="public-focus public-text-link">
                <bdi dir="ltr">{clinic.phonePrimary}</bdi>
              </a>
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
