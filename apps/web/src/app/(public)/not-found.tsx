import Link from 'next/link';

export default function PublicNotFound() {
  return (
    <main id="main-content" className="public-shell b2-not-found">
      <p className="public-kicker">والا</p>
      <h1>این صفحه پیدا نشد</h1>
      <p>ممکن است محتوای موردنظر منتشر نشده باشد یا نشانی آن تغییر کرده باشد.</p>
      <Link href="/" className="public-focus public-button public-button--gold">
        بازگشت به خانه
      </Link>
    </main>
  );
}
