import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EvaluationCallout, toPersianNumber } from '@/components/public-content';
import { getPublicMetadataContext, getPublicService } from '@/server/public-site';
import { privatePublicMetadata, publicMetadata, publicPageTitle } from '@/server/public-seo';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const [read, context] = await Promise.all([getPublicService(slug), getPublicMetadataContext()]);
  if (read.status !== 'ready')
    return privatePublicMetadata(publicPageTitle('خدمت', context.clinicName));
  return publicMetadata({
    title: publicPageTitle(read.data.name, context.clinicName),
    description: read.data.description,
    path: `/services/${read.data.slug}`,
    clinicName: context.clinicName,
    image: context.openGraphImage,
  });
}

export default async function ServiceDetailPage({ params }: Props) {
  const { slug } = await params;
  const read = await getPublicService(slug);
  if (read.status === 'not-found') notFound();

  if (read.status === 'unavailable') {
    return (
      <main id="main-content" className="public-shell b2-detail-fallback">
        <p className="public-kicker">خدمات</p>
        <h1>نمایش این خدمت موقتاً ممکن نیست</h1>
        <p>لطفاً کمی بعد دوباره بررسی کنید.</p>
        <Link href="/services" className="public-focus public-text-link">
          بازگشت به خدمات
        </Link>
      </main>
    );
  }

  const service = read.data;
  return (
    <main id="main-content">
      <article className="b2-service-detail">
        <div className="b2-service-detail__photo">
          <span className="public-media-empty">تصویر عمومی برای این خدمت منتشر نشده است</span>
        </div>
        <header className="public-shell b2-service-detail__copy">
          <Link href="/services" className="public-focus public-text-link public-text-link--light">
            خدمات / {service.name}
          </Link>
          <p className="public-kicker public-kicker--gold">خدمت منتشرشده</p>
          <h1>{service.name}</h1>
          {service.description ? (
            <p className="b2-detail-lead">{service.description}</p>
          ) : (
            <p className="b2-detail-lead">توضیح عمومی این خدمت هنوز تکمیل نشده است.</p>
          )}
        </header>
      </article>

      <section className="public-shell b2-fact-rule" aria-label="اطلاعات کوتاه خدمت">
        <div>
          <small>مناسب برای</small>
          <strong>اطلاعات تأییدشده هنوز منتشر نشده است</strong>
        </div>
        <div>
          <small>شروع کار</small>
          <strong>
            {service.sessionDurationsMinutes.length
              ? `جلسه‌های ${service.sessionDurationsMinutes
                  .map((minutes) => `${toPersianNumber(minutes)} دقیقه`)
                  .join(' یا ')}`
              : 'اطلاعات تأییدشده هنوز منتشر نشده است'}
          </strong>
        </div>
        <div>
          <small>فضای مربوط</small>
          <strong>اطلاعات تأییدشده هنوز منتشر نشده است</strong>
        </div>
      </section>

      <section className="public-shell b2-service-explainer">
        <div>
          <h2>ممکن است چه چیزی شما را به اینجا برساند</h2>
          <p className="b2-section-note">این فهرست تشخیص یا فهرست کامل شرایط نیست.</p>
          <ul className="b2-hairline-list">
            <li>جزئیات عمومی و تأییدشدهٔ این بخش هنوز منتشر نشده است.</li>
          </ul>
        </div>
        <div>
          <h2>جلسهٔ اول به‌طور کلی چطور می‌گذرد</h2>
          <ol className="b2-step-list">
            {['پیش از شروع', 'در طول جلسه', 'قدم بعدی'].map((label, step) => (
              <li key={label}>
                <span>{toPersianNumber(step + 1)}</span>
                <div>
                  <strong>{label}</strong>
                  <p>توضیح تأییدشدهٔ این مرحله هنوز منتشر نشده است.</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="b2-related-band">
        <div className="public-shell b2-related-band__inner">
          <div>
            <p className="public-kicker">درمانگران مرتبط</p>
            <h2>پروفایل مرتبط هنوز منتشر نشده است</h2>
          </div>
          <div>
            <p className="public-kicker">خواندنی مرتبط</p>
            <h2>نوشتهٔ مرتبط هنوز منتشر نشده است</h2>
          </div>
          <div className="b2-related-band__photo">
            <span className="public-media-empty">تصویر عمومی مرتبط منتشر نشده است</span>
          </div>
        </div>
      </section>
      <div className="public-shell b2-section-end">
        <EvaluationCallout
          serviceSlug={service.slug}
          title={`دربارهٔ ${service.name} سؤال دارید؟`}
        />
      </div>
    </main>
  );
}
