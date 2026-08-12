import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Service, Tariff, Therapist } from '@clinic/contracts';
import { TariffForm } from './tariffs/tariff-form';
import { TariffList } from './tariffs/tariff-list';
import { tariffState } from './tariffs/tariff-state';

/**
 * Rendering assertions for the tariff screens.
 *
 * The properties asserted here are the ones that would regress silently: that a
 * price never appears as a raw bigint or a timestamp, that immutability is
 * visible as void-and-replace rather than an edit button, that the paid and
 * free branches are both present and neither is preselected, and that the scope
 * of a correction cannot be changed.
 */

const CSRF = 'synthetic-csrf-token';
const TODAY = '2026-06-15';

const SERVICE: Service = {
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  name: 'Synthetic Service',
  publicDescription: null,
  isPublic: false,
  status: 'ACTIVE',
  deactivatedAt: null,
  allowedDurationsMinutes: [30, 45],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const INACTIVE_SERVICE: Service = {
  ...SERVICE,
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d',
  name: 'Retired Service',
  status: 'INACTIVE',
};

const NO_DURATION_SERVICE: Service = {
  ...SERVICE,
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5e',
  name: 'Unpriceable Service',
  allowedDurationsMinutes: [],
};

const THERAPIST: Therapist = {
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a60',
  fullName: 'Synthetic Therapist',
  specialty: 'Synthetic Specialty',
  status: 'ACTIVE',
  deactivatedAt: null,
  supportedServiceIds: [],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const INACTIVE_THERAPIST: Therapist = {
  ...THERAPIST,
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a61',
  fullName: 'Retired Therapist',
  status: 'INACTIVE',
};

const PAID: Tariff = {
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a70',
  serviceId: SERVICE.id,
  durationMinutes: 45,
  therapistId: null,
  priceMode: 'PAID',
  priceToman: '120000',
  freeReason: null,
  effectiveStart: '2026-01-01',
  effectiveEnd: null,
  voidedAt: null,
  voidReason: null,
  supersedesTariffId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const FREE: Tariff = {
  ...PAID,
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a71',
  priceMode: 'FREE',
  priceToman: '0',
  freeReason: 'complimentary screening',
};

const list = (overrides: Partial<Parameters<typeof TariffList>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(TariffList, {
      tariffs: [PAID],
      services: [SERVICE],
      therapists: [THERAPIST],
      today: TODAY,
      csrfToken: CSRF,
      errorMessage: null,
      canCreate: true,
      canVoid: true,
      ...overrides,
    }),
  );

describe('tariff state', () => {
  it.each([
    ['current', { effectiveStart: '2026-01-01', effectiveEnd: null }, 'current'],
    ['future', { effectiveStart: '2026-12-01', effectiveEnd: null }, 'future'],
    ['expired', { effectiveStart: '2025-01-01', effectiveEnd: '2025-12-31' }, 'expired'],
  ])('reports %s', (_label, dates, expected) => {
    expect(tariffState({ ...PAID, ...dates }, TODAY)).toBe(expected);
  });

  it('reports voided regardless of the dates', () => {
    expect(tariffState({ ...PAID, voidedAt: '2026-02-01T00:00:00.000Z' }, TODAY)).toBe('voided');
  });

  it('includes both boundary days in the current range', () => {
    expect(tariffState({ ...PAID, effectiveStart: TODAY, effectiveEnd: TODAY }, TODAY)).toBe(
      'current',
    );
  });
});

describe('tariff list', () => {
  it('keeps prices readable but hides create, correction and void controls without write permissions', () => {
    const markup = list({ canCreate: false, canVoid: false, voidTariffId: PAID.id });
    expect(markup).toContain('۱۲۰٬۰۰۰ تومان');
    expect(markup).not.toContain('/tariffs/new');
    expect(markup).not.toContain(`/tariffs?void=${PAID.id}`);
    expect(markup).not.toContain('action="/api/catalog/tariffs/void"');
  });

  it('formats money with Persian digits and never as a raw number', () => {
    const markup = list();

    expect(markup).toContain('۱۲۰٬۰۰۰ تومان');
    // The value crossed the API as a string; nothing here reintroduces a
    // JavaScript number or the undecorated digits.
    expect(markup).not.toContain('>120000<');
  });

  it('shows dates in Jalali and never as an ISO timestamp', () => {
    const markup = list();

    // 2026-01-01 is 11 Dey 1404.
    expect(markup).toContain('دی');
    expect(markup).not.toContain('2026-01-01');
    expect(markup).not.toContain('T00:00:00');
  });

  it('marks a free tariff with the free badge', () => {
    const markup = list({ tariffs: [FREE] });

    expect(markup).toContain('رایگان');
    expect(markup).toContain('complimentary screening');
  });

  it('shows each of the four states', () => {
    const markup = list({
      tariffs: [
        PAID,
        { ...PAID, id: 'a', effectiveStart: '2026-12-01' },
        { ...PAID, id: 'b', effectiveStart: '2025-01-01', effectiveEnd: '2025-12-31' },
        { ...PAID, id: 'c', voidedAt: '2026-02-01T00:00:00.000Z', voidReason: 'corrected' },
      ],
    });

    expect(markup).toContain('در حال اجرا');
    expect(markup).toContain('آینده');
    expect(markup).toContain('منقضی');
    expect(markup).toContain('ابطال‌شده');
  });

  it('names the service, duration and scope of each row', () => {
    const markup = list();

    expect(markup).toContain('Synthetic Service');
    expect(markup).toContain('۴۵ دقیقه');
    expect(markup).toContain('عمومی');
    expect(markup).not.toContain(SERVICE.id);
  });

  it('names the therapist on a therapist-specific row', () => {
    const markup = list({ tariffs: [{ ...PAID, therapistId: THERAPIST.id }] });

    expect(markup).toContain('Synthetic Therapist');
    expect(markup).not.toContain(THERAPIST.id);
  });

  it('offers correction and void, and no edit or delete', () => {
    const markup = list();

    expect(markup).toContain('/tariffs/new?supersedes=');
    expect(markup).toContain('ثبت اصلاحیه');
    expect(markup).toContain('ابطال');
    // A tariff is immutable: there is no edit route to link to, and nothing
    // deletes a price.
    expect(markup).not.toContain(`/tariffs/${PAID.id}/edit`);
    expect(markup).not.toContain('حذف');
  });

  it('offers no action on an already-voided row', () => {
    const markup = list({
      tariffs: [{ ...PAID, voidedAt: '2026-02-01T00:00:00.000Z', voidReason: 'corrected' }],
    });

    expect(markup).not.toContain('ثبت اصلاحیه');
    expect(markup).toContain('corrected');
  });

  it('shows the void form with its context only when a row is selected', () => {
    expect(list()).not.toContain('action="/api/catalog/tariffs/void"');

    const confirming = list({ voidTariffId: PAID.id });

    expect(confirming).toContain('action="/api/catalog/tariffs/void"');
    expect(confirming).toContain('method="post"');
    // The manager sees what they are withdrawing before typing a reason.
    expect(confirming).toContain('Synthetic Service');
    expect(confirming).toContain('۱۲۰٬۰۰۰ تومان');
    expect(confirming).toContain('name="reason"');
  });

  it('carries exactly one CSRF token per form', () => {
    const markup = list({ voidTariffId: PAID.id });
    const forms = markup.match(/<form/g)?.length ?? 0;
    const tokens = markup.match(new RegExp(`value="${CSRF}"`, 'g'))?.length ?? 0;

    expect(forms).toBeGreaterThan(0);
    expect(tokens).toBe(forms);
  });

  it('renders an empty state', () => {
    const markup = list({ tariffs: [] });

    expect(markup).toContain('هنوز تعرفه‌ای ثبت نشده است');
    expect(markup).toContain('/tariffs/new');
  });

  it('announces an error with role="alert"', () => {
    expect(list({ errorMessage: 'خطای نمونه' })).toContain('role="alert"');
  });
});

describe('tariff form', () => {
  const form = (overrides: Partial<Parameters<typeof TariffForm>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(TariffForm, {
        services: [SERVICE],
        therapists: [THERAPIST],
        serviceNames: new Map([[SERVICE.id, SERVICE.name]]),
        therapistNames: new Map([[THERAPIST.id, THERAPIST.fullName]]),
        csrfToken: CSRF,
        errorMessage: null,
        ...overrides,
      }),
    );

  it('offers service and duration as one combined option', () => {
    const markup = form();

    // One list of real combinations: a separate duration select could offer a
    // duration the chosen service does not have.
    expect(markup).toContain(`value="${SERVICE.id}:30"`);
    expect(markup).toContain(`value="${SERVICE.id}:45"`);
    expect(markup).toContain('۳۰ دقیقه');
    expect(markup).toContain('name="serviceDuration"');
  });

  it('omits inactive services and services with no durations', () => {
    const markup = form({ services: [SERVICE, INACTIVE_SERVICE, NO_DURATION_SERVICE] });

    expect(markup).not.toContain('Retired Service');
    expect(markup).not.toContain('Unpriceable Service');
    expect(markup).toContain('Synthetic Service');
  });

  it('offers only active therapists', () => {
    const markup = form({ therapists: [THERAPIST, INACTIVE_THERAPIST] });

    expect(markup).toContain('Synthetic Therapist');
    expect(markup).not.toContain('Retired Therapist');
  });

  it('asks for the scope explicitly and defaults to general', () => {
    const markup = form();

    expect(markup).toContain('value="general"');
    expect(markup).toContain('value="therapist"');
    expect(/id="scope-general"[^>]*checked/.test(markup)).toBe(true);
    // The fallback rule is stated, not left to be inferred.
    expect(markup).toContain('مگر آنکه تعرفهٔ اختصاصی همان درمانگر ثبت شده باشد');
  });

  it('renders both price branches with neither preselected', () => {
    const markup = form();

    expect(markup).toContain('value="PAID"');
    expect(markup).toContain('value="FREE"');
    // Choosing has to be deliberate, so nothing is checked by default.
    expect(/id="priceMode-paid"[^>]*checked/.test(markup)).toBe(false);
    expect(/id="priceMode-free"[^>]*checked/.test(markup)).toBe(false);
  });

  it('explains that free means a clinic programme, not an individual discount', () => {
    const markup = form();

    expect(markup).toContain('name="confirmFreePrice"');
    expect(markup).toContain('نه تخفیف برای یک خانوادهٔ خاص');
  });

  it('uses Jalali selects rather than a native date input', () => {
    const markup = form();

    // A native date input is Gregorian in every browser; labelling one as
    // Jalali would show one calendar and submit another.
    expect(markup).not.toContain('type="date"');
    expect(markup).toContain('name="start-year"');
    expect(markup).toContain('name="start-month"');
    expect(markup).toContain('name="start-day"');
    expect(markup).toContain('name="end-year"');
    expect(markup).toContain('فروردین');
    expect(markup).toContain('۱۴۰۵');
  });

  it('locks the scope when correcting and keeps it as hidden fields', () => {
    const markup = form({ supersedes: PAID });

    expect(markup).toContain('اصلاح تعرفه');
    expect(markup).toContain(`name="supersedesTariffId" value="${PAID.id}"`);
    expect(markup).toContain(`value="${PAID.serviceId}:45"`);
    // Shown for confirmation, but not as an editable control.
    expect(markup).not.toContain('name="serviceDuration" id=');
    expect(markup).toContain('قابل تغییر نیست');
    expect(markup).toContain('Synthetic Service');
  });

  it('preserves the therapist scope of the tariff being corrected', () => {
    const markup = form({ supersedes: { ...PAID, therapistId: THERAPIST.id } });

    expect(markup).toContain(`name="therapistId" value="${THERAPIST.id}"`);
    expect(markup).toContain('Synthetic Therapist');
  });

  it('prefills the start date of the tariff being corrected', () => {
    const markup = form({ supersedes: PAID });

    // 2026-01-01 is 11 Dey 1404.
    expect(markup).toMatch(/name="start-year"[\s\S]*?value="1404" selected/);
  });

  it('explains when nothing can be priced yet', () => {
    const markup = form({ services: [NO_DURATION_SERVICE] });

    expect(markup).toContain('ابتدا باید خدمتی فعال با دست‌کم یک مدت‌زمان');
    expect(markup).not.toContain('name="serviceDuration"');
  });

  it('posts to the create handler and blocks neither paste nor autofill', () => {
    const markup = form();

    expect(markup).toContain('action="/api/catalog/tariffs/create"');
    expect(markup).not.toContain('autocomplete="off"');
    expect(markup).not.toContain('onpaste');
  });
});
