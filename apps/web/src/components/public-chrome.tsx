import Link from 'next/link';
import type { PublicClinicProfile } from '@clinic/contracts';
import { PublicMobileMenu } from './public-mobile-menu';

const navigation = [
  { href: '/#services', label: 'خدمات' },
  { href: '/#team', label: 'تیم درمان' },
  { href: '/#about', label: 'درباره ما' },
  { href: '/#contact', label: 'ارتباط با کلینیک' },
] as const;

export function PublicMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="public-brand" aria-label="صفحهٔ نخست">
      <svg className="public-brand__mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <path d="M11 29.5c5.2-1.2 8.1-5.1 9.2-11.7 5.9 1.6 10.7 5.1 14.4 10.6" />
        <path d="M17.4 35.5c4.2-1 7.3-3.6 9.3-7.8" />
        <circle cx="12" cy="18" r="4" />
        <circle cx="35.5" cy="32.5" r="3.5" />
      </svg>
      {compact ? null : <span>مسیر توان‌بخشی</span>}
    </span>
  );
}

export function PublicHeader({ clinic }: { clinic: PublicClinicProfile }) {
  const contactHref = clinic.phonePrimary === null ? '/#contact' : `tel:${clinic.phonePrimary}`;
  const contactLabel = clinic.phonePrimary === null ? 'راه‌های ارتباطی' : 'تماس با کلینیک';

  return (
    <header className="public-header">
      <div className="public-header__inner">
        <Link href="/" className="public-focus public-brand-link">
          <PublicMark />
        </Link>

        <nav className="public-nav public-nav--desktop" aria-label="پیمایش اصلی">
          {navigation.map((item) => (
            <Link key={item.href} href={item.href} className="public-focus public-nav__link">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="public-header__actions">
          <a href={contactHref} className="public-focus public-button public-button--header">
            {contactLabel}
            <ArrowIcon />
          </a>
          <PublicMobileMenu
            items={navigation}
            contactHref={contactHref}
            contactLabel={contactLabel}
          />
        </div>
      </div>
    </header>
  );
}

export function PublicFooter({ clinic }: { clinic: PublicClinicProfile }) {
  return (
    <footer className="public-footer">
      <div className="public-shell public-footer__grid">
        <div className="public-footer__intro">
          <Link href="/" className="public-focus public-brand-link public-brand-link--footer">
            <PublicMark />
          </Link>
          <p>
            {clinic.tagline ??
              'فضایی روشن برای آشنایی با خدمات، تیم درمان و راه‌های ارتباط با کلینیک.'}
          </p>
        </div>

        <nav aria-label="پیوندهای پایین صفحه" className="public-footer__links">
          <strong>دسترسی سریع</strong>
          {navigation.slice(0, 3).map((item) => (
            <Link key={item.href} href={item.href} className="public-focus">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="public-footer__contact">
          <strong>ارتباط</strong>
          {clinic.phonePrimary !== null ? (
            <a href={`tel:${clinic.phonePrimary}`} className="public-focus">
              <bdi dir="ltr">{clinic.phonePrimary}</bdi>
            </a>
          ) : (
            <Link href="/#contact" className="public-focus">
              مشاهدهٔ راه‌های ارتباطی
            </Link>
          )}
          {clinic.cityLabel !== null ? <span>{clinic.cityLabel}</span> : null}
        </div>
      </div>
      <div className="public-shell public-footer__base">
        <span>اطلاعات این وب‌سایت از محتوای تأییدشدهٔ کلینیک نمایش داده می‌شود.</span>
        <Link href="/login" className="public-focus">
          ورود کارکنان
        </Link>
      </div>
    </footer>
  );
}

export function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M4 10h11M11 6l4 4-4 4" />
    </svg>
  );
}
