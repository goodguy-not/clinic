import type { ReactNode } from 'react';
import { PublicFooter, PublicHeader } from '@/components/public-chrome';
import { getPublicClinicProfile } from '@/server/public-site';
import './public.css';
import './b2.css';

export default async function PublicLayout({ children }: { children: ReactNode }) {
  const { data: clinic } = await getPublicClinicProfile();

  return (
    <div className="public-site">
      <a href="#main-content" className="public-skip-link">
        رفتن به محتوای اصلی
      </a>
      <PublicHeader clinic={clinic} />
      {children}
      <PublicFooter clinic={clinic} />
    </div>
  );
}
