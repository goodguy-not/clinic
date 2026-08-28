import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { COPY } from '@/server/copy-fa';
import './globals.css';

export const metadata: Metadata = {
  title: COPY.appTitle,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Persian, right-to-left, Vazirmatn self-hosted via globals.css.
  return (
    <html lang="fa" dir="rtl">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
