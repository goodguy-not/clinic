import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * The pathless internal route boundary.
 *
 * Every authenticated, authentication, and recovery page is structurally
 * noindex. Individual pages may keep their older declarations, but a new
 * internal route is protected from indexing by where it lives rather than by
 * an easy-to-forget page export.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function InternalLayout({ children }: { children: ReactNode }) {
  return children;
}
