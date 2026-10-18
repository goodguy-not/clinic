import Link from 'next/link';
import type { PublicClinicProfile } from '@clinic/contracts';
import { PublicMobileMenu } from './public-mobile-menu';

export function PublicMark({
  compact = false,
  light = false,
  clinicName,
}: {
  compact?: boolean;
  light?: boolean;
  clinicName: string | null;
}) {
  const logoSrc = light
    ? '/brand/vala-logo-horizontal-white.svg'
    : '/brand/vala-logo-horizontal.svg';

  return (
    <picture className="public-brand">
      {compact ? <source media="(max-width: 35rem)" srcSet="/brand/vala-icon.svg" /> : null}
      <img
        src={logoSrc}
        width="1311"
        height="582"
        alt={clinicName ? `نشان ${clinicName}` : 'نشان کلینیک'}
        className="public-brand__artwork"
      />
    </picture>
  );
}

export function PublicHeader({ clinic }: { clinic: PublicClinicProfile }) {
  const contactHref = '/request';
  const contactLabel = 'درخواست ارزیابی';
  const navigation = [
    { href: '/services', label: 'خدمات' },
    { href: '/team', label: 'تیم درمان' },
    { href: '/about', label: `دربارهٔ ${clinic.displayName ?? 'کلینیک'}` },
    { href: '/articles', label: 'خواندنی‌ها' },
    { href: '/testimonials', label: 'تجربهٔ خانواده‌ها' },
    { href: '/contact', label: 'تماس' },
  ] as const;

  return (
    <>
      <header className="public-header">
        <div className="public-header__inner">
          <div className="public-header__orientation">
            <Link href="/" className="public-focus public-brand-link">
              <PublicMark compact clinicName={clinic.displayName} />
            </Link>

            <nav className="public-nav public-nav--desktop" aria-label="پیمایش اصلی">
              {navigation.map((item) => (
                <Link key={item.href} href={item.href} className="public-focus public-nav__link">
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="public-header__actions">
            {clinic.workingHoursNote !== null || clinic.phonePrimary !== null ? (
              <div className="public-header__contact">
                {clinic.workingHoursNote !== null ? <span>{clinic.workingHoursNote}</span> : null}
                {clinic.phonePrimary !== null ? (
                  <a href={`tel:${clinic.phonePrimary}`} className="public-focus">
                    <bdi dir="ltr">{clinic.phonePrimary}</bdi>
                  </a>
                ) : null}
              </div>
            ) : null}
            <a href={contactHref} className="public-focus public-button public-button--header">
              {contactLabel}
              <span aria-hidden="true">←</span>
            </a>
            <PublicMobileMenu
              items={navigation}
              contactHref={contactHref}
              contactLabel={contactLabel}
            />
          </div>
        </div>
      </header>
      <div className="public-mobile-sticky" role="region" aria-label="شروع درخواست ارزیابی">
        <span>برای شروع آماده‌اید؟</span>
        <a href={contactHref} className="public-focus">
          {contactLabel}
          <span aria-hidden="true">←</span>
        </a>
      </div>
    </>
  );
}

export function PublicFooter({ clinic }: { clinic: PublicClinicProfile }) {
  return (
    <footer className="public-footer">
      <div className="public-shell public-footer__grid">
        <div className="public-footer__intro">
          <Link href="/" className="public-focus public-brand-link public-brand-link--footer">
            <PublicMark light clinicName={clinic.displayName} />
          </Link>
          <p>همراه خانواده برای فهمیدن شرایط و روشن‌کردن قدم بعدی.</p>
        </div>

        <nav aria-label="خدمات و تیم" className="public-footer__links">
          <strong>آشنایی با {clinic.displayName ?? 'کلینیک'}</strong>
          <Link href="/services" className="public-focus">
            خدمات
          </Link>
          <Link href="/team" className="public-focus">
            تیم درمان
          </Link>
          <Link href="/about" className="public-focus">
            دربارهٔ {clinic.displayName ?? 'کلینیک'}
          </Link>
        </nav>

        <nav aria-label="پیوندهای عمومی" className="public-footer__links">
          <strong>اطلاعات</strong>
          <Link href="/testimonials" className="public-focus">
            تجربهٔ خانواده‌ها
          </Link>
          <Link href="/articles" className="public-focus">
            خواندنی‌ها
          </Link>
          <Link href="/contact" className="public-focus">
            تماس
          </Link>
          <Link href="/privacy" className="public-focus">
            حریم خصوصی
          </Link>
        </nav>

        <div className="public-footer__contact">
          <strong>ارتباط</strong>
          {clinic.phonePrimary !== null ? (
            <a href={`tel:${clinic.phonePrimary}`} className="public-focus">
              <bdi dir="ltr">{clinic.phonePrimary}</bdi>
            </a>
          ) : (
            <Link href="/contact" className="public-focus">
              راه‌های ارتباطی
            </Link>
          )}
          {clinic.cityLabel !== null ? <span>{clinic.cityLabel}</span> : null}
          {clinic.addressLine !== null ? <span>{clinic.addressLine}</span> : null}
          <Link href="/request" className="public-focus public-footer__cta">
            درخواست ارزیابی
            <span aria-hidden="true">←</span>
          </Link>
        </div>
      </div>
      <div className="public-shell public-footer__base">
        <span>اطلاعات عمومی از محتوای تأییدشدهٔ کلینیک نمایش داده می‌شود.</span>
        {clinic.displayName ? <span>© {clinic.displayName}</span> : null}
      </div>
    </footer>
  );
}

export function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M16 10H5m4-4-4 4 4 4" />
    </svg>
  );
}
