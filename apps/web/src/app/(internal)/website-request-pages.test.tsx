import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { WebsiteRequestDetail, WebsiteRequestInboxResponse } from '@clinic/contracts';
import { FamilyForm } from './families/family-form';
import { WebsiteRequestDetailView } from './website-requests/website-request-detail';
import { WebsiteRequestInbox } from './website-requests/website-request-inbox';

const REQUEST_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4e31';
const FAMILY_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4e32';
const CSRF = 'v1.synthetic.csrf';

const live: Extract<WebsiteRequestDetail, { contentPurged: false }> = {
  id: REQUEST_ID,
  contentPurged: false,
  purgedAt: null,
  receivedAt: '2026-08-30T07:30:00.000Z',
  status: 'NEW',
  statusChangedAt: null,
  closedAt: null,
  linkedFamily: null,
  linkedAt: null,
  contactName: 'تماس‌گیرندهٔ ساختگی',
  contactMobile: '09120000000',
  childName: null,
  childAgeYears: 7,
  childSex: 'FEMALE',
  preferredContactTime: 'MORNING',
  requestedService: { id: FAMILY_ID, name: 'گفتاردرمانی آزمایشی' },
  hasNote: true,
  note: 'یادداشت ساختگی برای آزمون',
};

const purged: WebsiteRequestDetail = {
  id: REQUEST_ID,
  contentPurged: true,
  purgedAt: '2026-08-30T10:00:00.000Z',
  receivedAt: '2026-04-01T07:30:00.000Z',
  status: 'CLOSED',
  statusChangedAt: '2026-04-02T07:30:00.000Z',
  closedAt: '2026-04-02T07:30:00.000Z',
  linkedFamily: null,
  linkedAt: null,
};

function detail(request: WebsiteRequestDetail, canLink = false): string {
  return renderToStaticMarkup(
    createElement(WebsiteRequestDetailView, {
      request,
      csrfToken: CSRF,
      canProcess: true,
      canLink,
      canCreateFamily: canLink,
      errorMessage: null,
      successMessage: null,
    }),
  );
}

describe('website-request inbox', () => {
  const inbox: WebsiteRequestInboxResponse = {
    requests: [live, purged],
    page: { page: 1, pageSize: 25, total: 2, hasMore: false },
    statusCounts: [
      { status: 'NEW', count: 1 },
      { status: 'CONTACTED', count: 0 },
      { status: 'FOLLOW_UP_NEEDED', count: 0 },
      { status: 'CONVERTED_TO_FAMILY', count: 0 },
      { status: 'CLOSED', count: 1 },
    ],
  };

  it('renders authorised triage facts and a deliberate purged state', () => {
    const markup = renderToStaticMarkup(
      createElement(WebsiteRequestInbox, { inbox, selectedStatuses: [] }),
    );

    expect(markup).toContain(live.contactName);
    expect(markup).toContain(live.contactMobile);
    expect(markup).toContain('۷ سال');
    expect(markup).toContain('گفتاردرمانی آزمایشی');
    expect(markup).toContain('یادداشت دارد');
    expect(markup).toContain('اطلاعات شخصی طبق سیاست نگهداری حذف شده است');
    expect(markup).not.toContain(live.note ?? '');
    expect(markup).not.toMatch(/fingerprint|submitter|ipHash|consentVersion/i);
  });

  it('offers status filters backed by the API counts', () => {
    const markup = renderToStaticMarkup(
      createElement(WebsiteRequestInbox, { inbox, selectedStatuses: ['NEW'] }),
    );

    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('/website-requests?statuses=NEW');
    expect(markup).toContain('بسته‌شده · ۱');
  });
});

describe('website-request detail and legal actions', () => {
  it('shows intake facts, intentional missing values, and only legal manual transitions', () => {
    const markup = detail(live);

    expect(markup).toContain(live.contactName);
    expect(markup).toContain('نام کودک');
    expect(markup).toContain('ثبت نشده');
    expect(markup).toContain('action="/api/website-requests/status"');
    expect(markup).toContain('value="CONTACTED"');
    expect(markup).toContain('value="FOLLOW_UP_NEEDED"');
    expect(markup).toContain('value="CLOSED"');
    expect(markup).not.toContain('value="CONVERTED_TO_FAMILY"');
    expect(markup).not.toContain('name="reason"');
  });

  it('offers no lifecycle or conversion action for terminal and purged requests', () => {
    const closed = detail({
      ...live,
      status: 'CLOSED',
      statusChangedAt: '2026-08-30T08:30:00.000Z',
      closedAt: '2026-08-30T08:30:00.000Z',
    });
    const erased = detail(purged);

    for (const markup of [closed, erased]) {
      expect(markup).not.toContain('action="/api/website-requests/status"');
      expect(markup).not.toContain('action="/api/website-requests/link"');
      expect(markup).not.toContain('fromWebsiteRequest=');
      expect(markup).toContain('این وضعیت نهایی است');
    }
    expect(erased).toContain('طبق سیاست نگهداری حذف شده است');
    expect(erased).not.toContain(live.contactName);
    expect(erased).not.toContain(live.contactMobile);
  });

  it('keeps conversion explicit and confirms both linking and terminal closure', () => {
    const detailSource = readFileSync(
      new URL('website-requests/website-request-detail.tsx', import.meta.url),
      'utf8',
    );
    const searchSource = readFileSync(
      new URL('website-requests/website-request-family-search.tsx', import.meta.url),
      'utf8',
    );
    const searchActionSource = readFileSync(
      new URL('website-requests/family-search-action.ts', import.meta.url),
      'utf8',
    );

    expect(detailSource).toContain('WEBSITE_REQUEST_LEGAL_TRANSITIONS');
    expect(detailSource).toContain('ConfirmedSubmitButton');
    expect(detailSource).toContain('/families/new?fromWebsiteRequest=');
    expect(searchSource).toContain('name="familyId"');
    expect(searchSource).toContain('window.confirm');
    expect(searchActionSource).toContain('if (!searched)');
    expect(searchSource).not.toMatch(/best.?guess|automatic/i);
  });
});

describe('website-request family-registration handoff', () => {
  it('prefills only direct contact fields and labels the intake source', () => {
    const markup = renderToStaticMarkup(
      createElement(FamilyForm, {
        csrfToken: CSRF,
        errorMessage: null,
        websiteRequest: live,
      }),
    );

    expect(markup).toContain('اطلاعات منبع: درخواست وب‌سایت');
    expect(markup).toContain(`name="websiteRequestId" value="${REQUEST_ID}"`);
    expect(markup).toMatch(
      new RegExp(
        `id="guardian-1-fullName"[^>]+name="guardian-1-fullName"[^>]+value="${live.contactName}"`,
      ),
    );
    expect(markup).toMatch(
      new RegExp(
        `id="guardian-1-mobile"[^>]+name="guardian-1-mobile"[^>]+value="${live.contactMobile}"`,
      ),
    );
    expect(markup).toContain('سن اعلام‌شدهٔ کودک به تاریخ تولد تبدیل نمی‌شود');
    expect(markup).not.toContain('name="birthDate"');
    expect(markup).not.toContain('name="childName"');
  });

  it('threads the request through the existing duplicate confirmation routes', () => {
    const create = readFileSync(
      new URL('../api/families/create/route.ts', import.meta.url),
      'utf8',
    );
    const confirm = readFileSync(
      new URL('../api/families/confirm-registration/route.ts', import.meta.url),
      'utf8',
    );

    for (const source of [create, confirm]) {
      expect(source).toContain('websiteRequestId');
      expect(source).toContain('api.linkWebsiteRequest');
      expect(source).toContain('FAMILY_POSSIBLE_DUPLICATE');
    }
    expect(create.indexOf('api.createFamily')).toBeLessThan(
      create.indexOf('api.linkWebsiteRequest'),
    );
    expect(confirm.indexOf('api.confirmFamilyRegistration')).toBeLessThan(
      confirm.indexOf('api.linkWebsiteRequest'),
    );
  });
});

describe('website-request route and permission boundary', () => {
  it('requires the read authority on inbox and detail pages', () => {
    const inboxPage = readFileSync(new URL('website-requests/page.tsx', import.meta.url), 'utf8');
    const detailPage = readFileSync(
      new URL('website-requests/[id]/page.tsx', import.meta.url),
      'utf8',
    );
    const header = readFileSync(
      new URL('../../components/app-header.tsx', import.meta.url),
      'utf8',
    );

    expect(inboxPage).toContain("requirePermission: 'website_request.read'");
    expect(detailPage).toContain("requirePermission: 'website_request.read'");
    expect(header).toContain("permissions.includes('website_request.read')");
  });

  it('keeps writes on named guarded handlers and reads server-to-server', () => {
    for (const path of [
      '../api/website-requests/status/route.ts',
      '../api/website-requests/link/route.ts',
    ]) {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8');
      expect(source).toContain('guardStateChanging');
      expect(source).toContain('sessionTokenFrom');
      expect(source).not.toMatch(/console\.(?:log|info|warn|error)/);
    }
  });
});
