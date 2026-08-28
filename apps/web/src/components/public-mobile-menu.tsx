'use client';

import Link from 'next/link';
import { useRef } from 'react';

type NavigationItem = { href: string; label: string };

/**
 * The public site's only interactive island.
 *
 * `<details>` provides the disclosure, keyboard behavior, and no-JS fallback.
 * This island owns one refinement the native element cannot express: closing
 * the menu after an in-page destination is selected, so it does not cover the
 * content the visitor just asked to see.
 */
export function PublicMobileMenu({
  items,
  contactHref,
  contactLabel,
}: {
  items: readonly NavigationItem[];
  contactHref: string;
  contactLabel: string;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const close = () => detailsRef.current?.removeAttribute('open');

  return (
    <details ref={detailsRef} className="public-menu">
      <summary className="public-focus public-menu__summary" aria-label="باز کردن منو">
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </summary>
      <nav className="public-menu__panel" aria-label="پیمایش موبایل">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="public-focus public-menu__link"
            onClick={close}
          >
            {item.label}
          </Link>
        ))}
        <a
          href={contactHref}
          className="public-focus public-button public-button--mobile"
          onClick={close}
        >
          {contactLabel}
        </a>
      </nav>
    </details>
  );
}
