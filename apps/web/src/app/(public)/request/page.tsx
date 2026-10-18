import type { Metadata } from 'next';
import { RequestForm } from './request-form';
import {
  getPublicClinicProfile,
  getPublicMetadataContext,
  getPublicService,
} from '@/server/public-site';
import { publicMetadata, publicPageTitle } from '@/server/public-seo';

export async function generateMetadata(): Promise<Metadata> {
  const { clinicName, openGraphImage } = await getPublicMetadataContext();
  return publicMetadata({
    title: publicPageTitle('درخواست ارزیابی', clinicName),
    description:
      'ثبت درخواست ارزیابی برای بررسی کلینیک و تماس جهت هماهنگی؛ این درخواست رزرو نوبت نیست.',
    path: '/request',
    clinicName,
    image: openGraphImage,
  });
}

type Props = { searchParams: Promise<{ service?: string | string[] }> };

export default async function RequestPage({ searchParams }: Props) {
  const serviceParam = (await searchParams).service;
  const candidate = typeof serviceParam === 'string' ? serviceParam : null;
  const [service, clinicRead] = await Promise.all([
    candidate === null ? null : getPublicService(candidate),
    getPublicClinicProfile(),
  ]);
  const context = service?.status === 'ready' ? service.data : null;
  const clinicName = clinicRead.data.displayName;

  return (
    <main id="main-content" className="request-page">
      <section className="request-page__hero">
        <div className="public-shell request-page__layout">
          <div className="request-page__form-column">
            <header className="request-page__heading">
              <p className="public-kicker public-kicker--gold">درخواست ارزیابی</p>
              <h1>اگر مطمئن نیستید، بپرسید.</h1>
              <p>
                اطلاعات کوتاهی بگذارید؛ {clinicName ?? 'کلینیک'} آن را بررسی می‌کند و برای هماهنگی
                قدم بعدی با شما تماس می‌گیرد. با این فرم نوبتی رزرو نمی‌شود.
              </p>
            </header>
            <RequestForm
              serviceSlug={context?.slug ?? null}
              serviceName={context?.name ?? null}
              clinicName={clinicName}
            />
          </div>

          <aside className="request-next" aria-labelledby="request-next-title">
            <h2 id="request-next-title">بعد از ارسال چه می‌شود</h2>
            <ol>
              <li>
                <span>۱</span>
                <p>اطلاعات شما ثبت می‌شود.</p>
              </li>
              <li>
                <span>۲</span>
                <p>{clinicName ?? 'کلینیک'} آن را بررسی می‌کند.</p>
              </li>
              <li>
                <span>۳</span>
                <p>کلینیک برای هماهنگی قدم بعدی با خانواده تماس می‌گیرد.</p>
              </li>
            </ol>
          </aside>
        </div>
      </section>
    </main>
  );
}
