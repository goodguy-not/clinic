import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PublicFooter, PublicHeader } from '@/components/public-chrome';
import { api } from '@/server/api-client';
import { callerContext, readSessionToken, requireManagerSession } from '@/server/auth-session';
import '../../../(public)/public.css';
import '../../../(public)/b2.css';
import '../../../(public)/request.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default async function PreviewLayout({ children }: { children: ReactNode }) {
  await requireManagerSession();
  const token = await readSessionToken();
  const clinic = await api.getClinicProfile(await callerContext(token ?? undefined));
  if (!clinic.ok) throw new Error(`Failed to load preview chrome: ${clinic.code}`);

  return (
    <div className="public-site">
      <div role="status" className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-950">
        پیش‌نمایش خصوصی مدیر — این نسخه روی سایت عمومی منتشر نشده است.
      </div>
      <a href="#main-content" className="public-skip-link">
        رفتن به محتوای اصلی
      </a>
      <PublicHeader clinic={clinic.data.clinic} />
      {children}
      <PublicFooter clinic={clinic.data.clinic} />
    </div>
  );
}
