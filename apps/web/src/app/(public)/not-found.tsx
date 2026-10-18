import Link from 'next/link';
import { getPublicClinicProfile } from '@/server/public-site';

export default async function PublicNotFound() {
  const { data: clinic } = await getPublicClinicProfile();
  return (
    <main id="main-content" className="public-shell b2-not-found">
      {clinic.displayName ? <p className="public-kicker">{clinic.displayName}</p> : null}
      <h1>این صفحه پیدا نشد</h1>
      <p>ممکن است محتوای موردنظر منتشر نشده باشد یا نشانی آن تغییر کرده باشد.</p>
      <Link href="/" className="public-focus public-button public-button--gold">
        بازگشت به خانه
      </Link>
    </main>
  );
}
