import type { Metadata } from 'next';
import Link from 'next/link';
import {
  EvaluationCallout,
  PageHero,
  PublicPageEmpty,
  toPersianNumber,
} from '@/components/public-content';
import { getPublicMetadataContext, getPublicServices } from '@/server/public-site';
import { publicMetadata, publicPageTitle } from '@/server/public-seo';

export async function generateMetadata(): Promise<Metadata> {
  const { clinicName, openGraphImage } = await getPublicMetadataContext();
  return publicMetadata({
    title: publicPageTitle('خدمات توانبخشی', clinicName),
    description: 'خدمات عمومی و منتشرشدهٔ کلینیک.',
    path: '/services',
    clinicName,
    image: openGraphImage,
  });
}

export default async function ServicesPage() {
  const services = await getPublicServices();

  return (
    <main id="main-content">
      <PageHero
        eyebrow="خدمات"
        title="در کلینیک چه کارهایی انجام می‌شود؟"
        lead="در این صفحه فقط توضیح‌های عمومی و تأییدشدهٔ هر خدمت نمایش داده می‌شود؛ برای انتخاب مسیر، ارزیابی لازم است."
        aside={
          services.data.length ? (
            <nav className="b2-page-index" aria-label="فهرست این صفحه">
              <strong>فهرست این صفحه</strong>
              {services.data.map((service) => (
                <a key={service.slug} href={`#service-${service.slug}`} className="public-focus">
                  <span>{service.name}</span>
                  <small>خدمت منتشرشده</small>
                </a>
              ))}
            </nav>
          ) : null
        }
      />
      <section className="public-shell b2-service-list" aria-label="فهرست خدمات منتشرشده">
        {services.data.length ? (
          services.data.map((service, index) => (
            <Link
              key={service.slug}
              id={`service-${service.slug}`}
              href={`/services/${service.slug}`}
              className="public-focus b2-service-row"
            >
              <div className="b2-service-row__photo">
                <span className="public-media-empty">تصویر عمومی برای این خدمت منتشر نشده است</span>
              </div>
              <div className="b2-service-row__copy">
                <span>{toPersianNumber(String(index + 1).padStart(2, '0'))}</span>
                <h2>{service.name}</h2>
                {service.description ? (
                  <p>{service.description}</p>
                ) : (
                  <p className="b2-muted">توضیح عمومی این خدمت هنوز تکمیل نشده است.</p>
                )}
                <div className="b2-service-row__facts">
                  <small>ممکن است چه شرایطی مرتبط باشد</small>
                  <span>جزئیات تأییدشده هنوز منتشر نشده است.</span>
                </div>
                <strong>
                  صفحهٔ {service.name} <span aria-hidden="true">←</span>
                </strong>
              </div>
            </Link>
          ))
        ) : (
          <PublicPageEmpty
            unavailable={services.status === 'unavailable'}
            title="خدمتی برای نمایش منتشر نشده است"
            text="پس از انتشار توضیحات تأییدشده، خدمات در همین صفحه دیده می‌شوند."
          />
        )}
      </section>
      <div className="public-shell b2-section-end">
        <EvaluationCallout />
      </div>
    </main>
  );
}
