import type { Metadata } from 'next';
import Link from 'next/link';
import { DevelopmentPhoto, PageHero, PublicPageEmpty } from '@/components/public-content';
import { getPublicClinicProfile } from '@/server/public-site';

export const metadata: Metadata = {
  title: 'تماس و نشانی | والا',
  description: 'راه‌های ارتباطی و موقعیت تأییدشدهٔ کلینیک توانبخشی والا.',
};

export default async function ContactPage() {
  const read = await getPublicClinicProfile();
  const clinic = read.data;
  const hasContact = [
    clinic.phonePrimary,
    clinic.phoneSecondary,
    clinic.email,
    clinic.addressLine,
    clinic.cityLabel,
    clinic.workingHoursNote,
  ].some(Boolean);
  const hasMap = clinic.mapLatitude !== null && clinic.mapLongitude !== null;
  const mapHref = hasMap
    ? `https://www.openstreetmap.org/?mlat=${clinic.mapLatitude}&mlon=${clinic.mapLongitude}#map=16/${clinic.mapLatitude}/${clinic.mapLongitude}`
    : null;

  return (
    <main id="main-content">
      <PageHero
        eyebrow="تماس"
        title="آمدن به والا"
        lead="می‌توانید با راه‌های تأییدشدهٔ زیر تماس بگیرید یا از مسیر درخواست ارزیابی شروع کنید."
      />
      <section className="public-shell b2-contact-layout" aria-label="راه‌های تماس و نشانی">
        <div className="b2-contact-card">
          <p className="public-kicker public-kicker--gold">اطلاعات تأییدشده</p>
          {hasContact ? (
            <dl>
              {clinic.phonePrimary ? (
                <>
                  <dt>تلفن اصلی</dt>
                  <dd>
                    <a
                      href={`tel:${clinic.phonePrimary}`}
                      className="public-focus public-text-link public-text-link--light"
                    >
                      <bdi dir="ltr">{clinic.phonePrimary}</bdi>
                    </a>
                  </dd>
                </>
              ) : null}
              {clinic.phoneSecondary ? (
                <>
                  <dt>تلفن دیگر</dt>
                  <dd>
                    <a
                      href={`tel:${clinic.phoneSecondary}`}
                      className="public-focus public-text-link public-text-link--light"
                    >
                      <bdi dir="ltr">{clinic.phoneSecondary}</bdi>
                    </a>
                  </dd>
                </>
              ) : null}
              {clinic.email ? (
                <>
                  <dt>ایمیل</dt>
                  <dd>
                    <a
                      href={`mailto:${clinic.email}`}
                      className="public-focus public-text-link public-text-link--light"
                    >
                      <bdi dir="ltr">{clinic.email}</bdi>
                    </a>
                  </dd>
                </>
              ) : null}
              {clinic.cityLabel || clinic.addressLine ? (
                <>
                  <dt>نشانی</dt>
                  <dd>{[clinic.cityLabel, clinic.addressLine].filter(Boolean).join('، ')}</dd>
                </>
              ) : null}
              {clinic.workingHoursNote ? (
                <>
                  <dt>ساعت تماس</dt>
                  <dd>{clinic.workingHoursNote}</dd>
                </>
              ) : null}
            </dl>
          ) : (
            <PublicPageEmpty
              unavailable={read.status === 'unavailable'}
              title="اطلاعات تماس هنوز تکمیل نشده است"
              text="نشانی و شماره‌های واقعی فقط پس از تأیید مالک کلینیک در این بخش نمایش داده می‌شوند."
            />
          )}
        </div>
        <div className="b2-map-column">
          <div className="b2-map-state" data-ready={hasMap || undefined}>
            <span aria-hidden="true" />
            {hasMap && mapHref ? (
              <a
                href={mapHref}
                target="_blank"
                rel="noreferrer"
                className="public-focus public-button public-button--gold"
              >
                باز کردن مسیر در نقشه <span aria-hidden="true">↗</span>
              </a>
            ) : (
              <strong>موقعیت در انتظار تأیید</strong>
            )}
          </div>
          <p>
            {hasMap
              ? 'موقعیت ثبت‌شده برای بازکردن در سرویس نقشه آماده است.'
              : 'قاب نقشه آماده است؛ مختصات ساختگی نمایش داده نمی‌شود.'}
          </p>
        </div>
      </section>

      <section className="public-shell b2-arrival-rule" aria-label="اطلاعات رسیدن به کلینیک">
        <div>
          <small>حمل‌ونقل عمومی</small>
          <strong>اطلاعات تأییدشده هنوز منتشر نشده است</strong>
        </div>
        <div>
          <small>پارکینگ</small>
          <strong>اطلاعات تأییدشده هنوز منتشر نشده است</strong>
        </div>
        <div>
          <small>دسترسی بدون پله</small>
          <strong>اطلاعات تأییدشده هنوز منتشر نشده است</strong>
        </div>
      </section>

      <section className="b2-arrival-band" aria-labelledby="arrival-title">
        <div className="public-shell b2-arrival-band__inner">
          <div>
            <p className="public-kicker">وقتی رسیدید</p>
            <h2 id="arrival-title">پیش از ورود چه بدانید</h2>
            <ul className="b2-hairline-list">
              <li>راهنمای تأییدشدهٔ ورودی هنوز منتشر نشده است.</li>
              <li>راهنمای تأییدشدهٔ پذیرش هنوز منتشر نشده است.</li>
              <li>راهنمای تأییدشدهٔ همراهان هنوز منتشر نشده است.</li>
            </ul>
          </div>
          <DevelopmentPhoto
            src="/dev/vala-synthetic/05-corridor.jpg"
            className="b2-contact-photo"
            sizes="(max-width: 56rem) 100vw, 46vw"
            priority
          />
        </div>
      </section>

      <section id="request" className="b2-contact-request">
        <div className="public-shell">
          <p className="public-kicker public-kicker--gold">درخواست ارزیابی</p>
          <h2>ترجیح می‌دهید ما تماس بگیریم؟</h2>
          <p>
            اطلاعات کوتاهی ثبت می‌شود، تیم والا آن را بررسی می‌کند و کلینیک برای هماهنگی قدم بعدی با
            خانواده تماس می‌گیرد. این درخواست به معنی رزرو نوبت نیست.
          </p>
          <Link href="/request" className="public-focus public-button public-button--gold">
            شروع درخواست ارزیابی
            <span aria-hidden="true">←</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
