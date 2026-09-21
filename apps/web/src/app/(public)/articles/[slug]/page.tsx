import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PublicArticleReading } from '@/components/public-article-reading';
import {
  getPublicArticle,
  getPublicArticles,
  getPublicMetadataContext,
} from '@/server/public-site';
import { privatePublicMetadata, publicMetadata, publicPageTitle } from '@/server/public-seo';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const [read, context] = await Promise.all([getPublicArticle(slug), getPublicMetadataContext()]);
  if (read.status !== 'ready')
    return privatePublicMetadata(publicPageTitle('خواندنی‌ها', context.clinicName));
  return publicMetadata({
    title: publicPageTitle(read.data.title, context.clinicName),
    description: read.data.summary,
    path: `/articles/${read.data.slug}`,
    clinicName: context.clinicName,
    image: read.data.images[0] ?? context.openGraphImage,
    kind: 'article',
    publishedTime: read.data.publishedAt,
  });
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
  const nearby = articleList.data.filter((item) => item.slug !== slug).slice(0, 2);
  return <PublicArticleReading article={article} nearby={nearby} />;
}
