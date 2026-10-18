import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArticlePhoto,
  EvaluationCallout,
  PageHero,
  PublicPageEmpty,
  formatPersianDate,
  toPersianNumber,
} from '@/components/public-content';
import { getPublicArticles, getPublicMetadataContext } from '@/server/public-site';
import { publicMetadata, publicPageTitle } from '@/server/public-seo';

export async function generateMetadata(): Promise<Metadata> {
  const { clinicName, openGraphImage } = await getPublicMetadataContext();
  return publicMetadata({
    title: publicPageTitle('خواندنی‌ها', clinicName),
    description: 'نوشته‌های عمومی و منتشرشدهٔ کلینیک.',
    path: '/articles',
    clinicName,
    image: openGraphImage,
  });
}

export default async function ArticlesPage() {
  const read = await getPublicArticles();
  const [featured, ...articles] = read.data;

  return (
    <main id="main-content">
      <PageHero
        eyebrow="خواندنی‌ها"
        title="سؤال‌هایی که زیاد می‌شنویم"
        lead="مطالب این صفحه عمومی‌اند و جای ارزیابی شرایط خود شما یا فرزندتان را نمی‌گیرند."
        aside={
          <p className="b2-hero-note">
            هر عنوان یک سؤال است؛ اطلاعات نویسنده، موضوع و زمان مطالعه پس از افزوده‌شدن به قرارداد
            عمومی نمایش داده می‌شود.
          </p>
        }
      />

      <section className="public-shell b2-articles" aria-label="مقاله‌های منتشرشده">
        {featured ? (
          <Link href={`/articles/${featured.slug}`} className="public-focus b2-featured-article">
            <ArticlePhoto
              image={featured.images[0] ?? null}
              className="b2-featured-article__photo"
              sizes="(max-width: 56rem) 100vw, 47vw"
              priority
            />
            <div>
              <p className="public-kicker">پیشنهاد برای شروع</p>
              <small>موضوع و زمان مطالعه هنوز منتشر نشده است</small>
              <h2>{featured.title}</h2>
              {featured.summary ? <p>{featured.summary}</p> : null}
              <time dateTime={featured.publishedAt}>{formatPersianDate(featured.publishedAt)}</time>
              <strong>
                خواندن این سؤال <span aria-hidden="true">←</span>
              </strong>
            </div>
          </Link>
        ) : (
          <PublicPageEmpty
            unavailable={read.status === 'unavailable'}
            title="مطلبی برای خواندن منتشر نشده است"
            text="پس از انتشار نوشته‌های تأییدشده، آن‌ها در همین صفحه دیده می‌شوند."
          />
        )}

        {articles.length ? (
          <>
            <div className="b2-topic-row" aria-label="موضوع‌های منتشرشده">
              <button type="button" className="public-focus" aria-pressed="true">
                همه
              </button>
              <p>
                {toPersianNumber(read.data.length)} نوشته؛ دادهٔ موضوع‌بندی هنوز منتشر نشده است.
              </p>
            </div>
            <div className="b2-article-list">
              {articles.map((article, index) => (
                <Link
                  key={article.slug}
                  href={`/articles/${article.slug}`}
                  className="public-focus b2-article-row"
                >
                  <span>{toPersianNumber(String(index + 2).padStart(2, '0'))}</span>
                  <div>
                    <h2>{article.title}</h2>
                    {article.summary ? <p>{article.summary}</p> : null}
                  </div>
                  <time dateTime={article.publishedAt}>
                    {formatPersianDate(article.publishedAt)}
                  </time>
                  <strong aria-hidden="true">←</strong>
                </Link>
              ))}
            </div>
            <p className="b2-index-note">
              شماره‌ها جایگاه نوشته در این فهرست‌اند، نه شمارهٔ انتشار.
            </p>
          </>
        ) : null}
      </section>
      <div className="public-shell b2-section-end">
        <EvaluationCallout title="سؤال شما دربارهٔ شرایط خودتان است؟" />
      </div>
    </main>
  );
}
