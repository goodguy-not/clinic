import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  DevelopmentPhoto,
  EvaluationCallout,
  formatPersianDate,
  toPersianNumber,
} from '@/components/public-content';
import { getPublicArticle, getPublicArticles } from '@/server/public-site';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const read = await getPublicArticle(slug);
  if (read.status !== 'ready') return { title: 'خواندنی‌ها | والا', robots: { index: false } };
  return { title: `${read.data.title} | والا`, description: read.data.summary ?? undefined };
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params;
  const [read, articleList] = await Promise.all([getPublicArticle(slug), getPublicArticles()]);
  if (read.status === 'not-found') notFound();

  if (read.status === 'unavailable') {
    return (
      <main id="main-content" className="public-shell b2-detail-fallback">
        <p className="public-kicker">خواندنی‌ها</p>
        <h1>نمایش این نوشته موقتاً ممکن نیست</h1>
        <p>لطفاً کمی بعد دوباره بررسی کنید.</p>
        <Link href="/articles" className="public-focus public-text-link">
          بازگشت به خواندنی‌ها
        </Link>
      </main>
    );
  }

  const article = read.data;
  const paragraphs = article.body.split(/\r?\n\s*\r?\n/).filter(Boolean);
  const nearby = articleList.data.filter((item) => item.slug !== slug).slice(0, 2);

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
        <DevelopmentPhoto
          src="/dev/vala-synthetic/01-reception.jpg"
          className="b2-reading__photo"
          sizes="(max-width: 47.99rem) 100vw, 960px"
          priority
        />
        <div className="b2-reading__body">
          {paragraphs.map((paragraph, index) => (
            <p key={`${index}-${paragraph.slice(0, 20)}`}>{paragraph}</p>
          ))}
        </div>
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
