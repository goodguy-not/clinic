import type { PublicArticleDetail, PublicArticleSummary } from '@clinic/contracts';
import Link from 'next/link';
import {
  ArticlePhoto,
  EvaluationCallout,
  formatPersianDate,
  toPersianNumber,
} from './public-content';

/** The article body used by both the published route and authenticated draft preview. */
export function PublicArticleReading({
  article,
  nearby = [],
}: {
  article: PublicArticleDetail;
  nearby?: PublicArticleSummary[];
}) {
  const paragraphs = article.body.split(/\r?\n\s*\r?\n/).filter(Boolean);

  return (
    <main id="main-content">
      <article className="public-shell b2-reading">
        <header>
          <Link href="/articles" className="public-focus public-text-link">
            همهٔ خواندنی‌ها
          </Link>
          <h1>{article.title}</h1>
          {article.summary ? <p className="b2-reading__summary">{article.summary}</p> : null}
          <div className="b2-reading__meta">
            <strong>نویسندهٔ عمومی هنوز منتشر نشده است</strong>
            <time dateTime={article.publishedAt}>{formatPersianDate(article.publishedAt)}</time>
            <span>زمان مطالعه هنوز منتشر نشده است</span>
          </div>
        </header>
        <ArticlePhoto
          image={article.images[0] ?? null}
          className="b2-reading__photo"
          sizes="(max-width: 47.99rem) 100vw, 960px"
          priority
        />
        <div className="b2-reading__body">
          {paragraphs.map((paragraph, index) => (
            <p key={`${index}-${paragraph.slice(0, 20)}`}>{paragraph}</p>
          ))}
        </div>
        {article.images.slice(1).map((image) => (
          <ArticlePhoto
            key={image.mediaId}
            image={image}
            className="b2-reading__photo"
            sizes="(max-width: 47.99rem) 100vw, 960px"
          />
        ))}
        <aside className="b2-related-service">
          <p className="public-kicker">خدمت مرتبط</p>
          <h2>ارتباط تأییدشده با یک خدمت هنوز منتشر نشده است</h2>
          <Link href="/services" className="public-focus public-text-link">
            دیدن همهٔ خدمات ←
          </Link>
        </aside>
        <aside className="b2-prototype-note">
          این صفحه فقط متن عمومی منتشرشده را نمایش می‌دهد و تشخیص یا دستور درمان نیست.
        </aside>
        <section className="b2-author-card" aria-labelledby="author-title">
          <p className="public-kicker">دربارهٔ نویسنده</p>
          <h2 id="author-title">پروفایل نویسنده در دادهٔ عمومی موجود نیست</h2>
        </section>
        {nearby.length ? (
          <nav className="b2-nearby" aria-label="سؤال‌های نزدیک">
            <h2>سؤال‌های نزدیک</h2>
            {nearby.map((item, index) => (
              <Link key={item.slug} href={`/articles/${item.slug}`} className="public-focus">
                <span>{toPersianNumber(index + 1)}</span>
                <strong>{item.title}</strong>
              </Link>
            ))}
          </nav>
        ) : null}
        <EvaluationCallout title="سؤالی دربارهٔ شرایط خودتان دارید؟" />
      </article>
    </main>
  );
}
