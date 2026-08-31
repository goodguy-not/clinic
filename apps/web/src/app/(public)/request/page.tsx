import type { Metadata } from 'next';
import { RequestForm } from './request-form';
import { getPublicService } from '@/server/public-site';

export const metadata: Metadata = {
  title: 'درخواست ارزیابی | والا',
  description: 'ثبت اطلاعات کوتاه برای بررسی تیم والا و هماهنگی قدم بعدی.',
};

type Props = { searchParams: Promise<{ service?: string | string[] }> };

export default async function RequestPage({ searchParams }: Props) {
  const serviceParam = (await searchParams).service;
  const candidate = typeof serviceParam === 'string' ? serviceParam : null;
  const service = candidate === null ? null : await getPublicService(candidate);
  const context = service?.status === 'ready' ? service.data : null;

  return (
    <main id="main-content" className="request-page">
      <section className="request-page__hero">
        <div className="public-shell request-page__layout">
          <div className="request-page__form-column">
            <header className="request-page__heading">
              <p className="public-kicker public-kicker--gold">درخواست ارزیابی</p>
              <h1>اگر مطمئن نیستید، بپرسید.</h1>
              <p>
                اطلاعات کوتاهی بگذارید؛ تیم والا آن را بررسی می‌کند و کلینیک برای هماهنگی قدم بعدی
                با شما تماس می‌گیرد. با این فرم نوبتی رزرو نمی‌شود.
              </p>
            </header>
            <RequestForm serviceSlug={context?.slug ?? null} serviceName={context?.name ?? null} />
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
                <p>تیم والا آن را بررسی می‌کند.</p>
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
