import type { Metadata } from 'next';
import Link from 'next/link';
import {
  DevelopmentPhoto,
  EvaluationCallout,
  PageHero,
  PublicPageEmpty,
  SERVICE_IMAGES,
  toPersianNumber,
} from '@/components/public-content';
import { getPublicServices } from '@/server/public-site';

export const metadata: Metadata = {
  title: 'خدمات توانبخشی | والا',
  description: 'خدمات عمومی و منتشرشدهٔ کلینیک توانبخشی والا.',
};

export default async function ServicesPage() {
  const services = await getPublicServices();

  return (
    <main id="main-content">
      <PageHero
        eyebrow="خدمات"
        title="برای هر قدم، یک همراه روشن"
        lead="خدمت‌ها را با توضیحی که خود کلینیک برای انتشار تأیید کرده است مرور کنید."
      />
      <section className="public-shell b2-service-list" aria-label="فهرست خدمات منتشرشده">
        {services.data.length ? (
          services.data.map((service, index) => (
            <Link
              key={service.slug}
              href={`/services/${service.slug}`}
              className="public-focus b2-service-row"
            >
              <DevelopmentPhoto
                src={SERVICE_IMAGES[index % SERVICE_IMAGES.length]!}
                className="b2-service-row__photo"
                sizes="(max-width: 56rem) 100vw, 39vw"
                priority={index === 0}
              />
              <div className="b2-service-row__copy">
                <span>{toPersianNumber(String(index + 1).padStart(2, '0'))}</span>
                <h2>{service.name}</h2>
                {service.description ? (
                  <p>{service.description}</p>
                ) : (
                  <p className="b2-muted">توضیح عمومی این خدمت هنوز تکمیل نشده است.</p>
                )}
                <strong>
                  دیدن جزئیات <span aria-hidden="true">←</span>
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
