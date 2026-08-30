import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EvaluationCallout, formatPersianDate } from '@/components/public-content';
import { getPublicArticle } from '@/server/public-site';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const read = await getPublicArticle(slug);
  if (read.status !== 'ready') return { title: 'خواندنی‌ها | والا', robots: { index: false } };
  return { title: `${read.data.title} | والا`, description: read.data.summary ?? undefined };
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params;
  const read = await getPublicArticle(slug);
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

  return (
    <main id="main-content">
      <article className="public-shell b2-reading">
        <header>
          <Link href="/articles" className="public-focus public-text-link">
            همهٔ خواندنی‌ها
          </Link>
          <p className="public-kicker">نوشتهٔ منتشرشده</p>
          <h1>{article.title}</h1>
          {article.summary ? <p className="b2-reading__summary">{article.summary}</p> : null}
          <time dateTime={article.publishedAt}>{formatPersianDate(article.publishedAt)}</time>
        </header>
        <div className="b2-reading__body">
          {paragraphs.map((paragraph, index) => (
            <p key={`${index}-${paragraph.slice(0, 20)}`}>{paragraph}</p>
          ))}
        </div>
        <EvaluationCallout title="سؤالی دربارهٔ شرایط خودتان دارید؟" />
      </article>
    </main>
  );
}
