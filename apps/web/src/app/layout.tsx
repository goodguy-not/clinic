import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Clinic Platform',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Persian, right-to-left. Brand assets, fonts, and approved copy are
  // owner-provided and arrive with the public-site milestone.
  return (
    <html lang="fa" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
