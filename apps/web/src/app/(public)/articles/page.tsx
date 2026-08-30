import type { Metadata } from 'next';
import Link from 'next/link';
import {
  DevelopmentPhoto,
  EvaluationCallout,
  PageHero,
  PublicPageEmpty,
  formatPersianDate,
  toPersianNumber,
} from '@/components/public-content';
import { getPublicArticles } from '@/server/public-site';

export const metadata: Metadata = {
  title: 'خواندنی‌ها | والا',
  description: 'نوشته‌های عمومی و منتشرشدهٔ کلینیک توانبخشی والا.',
};

export default async function ArticlesPage() {
  const read = await getPublicArticles();
  const [featured, ...articles] = read.data;

  return (
    <main id="main-content">
      <PageHero
        eyebrow="خواندنی‌ها"
        title="سؤال‌هایی که زیاد می‌شنویم"
        lead="مطالب این صفحه عمومی‌اند و جای ارزیابی شرایط خود شما یا فرزندتان را نمی‌گیرند."
      />

      <section className="public-shell b2-articles" aria-label="مقاله‌های منتشرشده">
        {featured ? (
          <Link href={`/articles/${featured.slug}`} className="public-focus b2-featured-article">
            <DevelopmentPhoto
              src="/dev/vala-synthetic/01-reception.jpg"
              className="b2-featured-article__photo"
              sizes="(max-width: 56rem) 100vw, 47vw"
              priority
            />
            <div>
              <p className="public-kicker">پیشنهاد برای شروع</p>
              <h2>{featured.title}</h2>
              {featured.summary ? <p>{featured.summary}</p> : null}
              <time dateTime={featured.publishedAt}>{formatPersianDate(featured.publishedAt)}</time>
              <strong>
                خواندن <span aria-hidden="true">←</span>
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
                <time dateTime={article.publishedAt}>{formatPersianDate(article.publishedAt)}</time>
                <strong aria-hidden="true">←</strong>
              </Link>
            ))}
          </div>
        ) : null}
      </section>
      <div className="public-shell b2-section-end">
        <EvaluationCallout title="سؤال شما دربارهٔ شرایط خودتان است؟" />
      </div>
    </main>
  );
}
