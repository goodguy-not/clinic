import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  DevelopmentPhoto,
  EvaluationCallout,
  SERVICE_IMAGES,
  toPersianNumber,
} from '@/components/public-content';
import { getPublicService, getPublicServices } from '@/server/public-site';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const read = await getPublicService(slug);
  if (read.status !== 'ready') return { title: 'خدمت | والا', robots: { index: false } };
  return { title: `${read.data.name} | والا`, description: read.data.description ?? undefined };
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
  const list = await getPublicServices();
  const index = Math.max(
    0,
    list.data.findIndex((item) => item.slug === slug),
  );

  return (
    <main id="main-content">
      <article className="public-shell b2-service-detail">
        <div className="b2-service-detail__copy">
          <Link href="/services" className="public-focus public-text-link">
            همهٔ خدمات
          </Link>
          <p className="public-eyebrow">
            <span aria-hidden="true" />
            خدمت منتشرشده
          </p>
          <h1>{service.name}</h1>
          {service.description ? (
            <p className="b2-detail-lead">{service.description}</p>
          ) : (
            <p className="b2-muted">توضیح عمومی این خدمت هنوز تکمیل نشده است.</p>
          )}
          {service.sessionDurationsMinutes.length ? (
            <section className="b2-duration" aria-labelledby="duration-title">
              <h2 id="duration-title">زمان‌های ارائهٔ جلسه</h2>
              <p>
                {service.sessionDurationsMinutes
                  .map((minutes) => `${toPersianNumber(minutes)} دقیقه`)
                  .join(' · ')}
              </p>
            </section>
          ) : null}
        </div>
        <DevelopmentPhoto
          src={SERVICE_IMAGES[index % SERVICE_IMAGES.length]!}
          className="b2-service-detail__photo"
          sizes="(max-width: 56rem) 100vw, 48vw"
          priority
        />
      </article>
      <div className="public-shell b2-section-end">
        <EvaluationCallout
          serviceSlug={service.slug}
          title={`دربارهٔ ${service.name} سؤال دارید؟`}
        />
      </div>
    </main>
  );
}
