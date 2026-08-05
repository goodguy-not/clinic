import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Service, Therapist } from '@clinic/contracts';
import { TherapistForm } from './therapists/therapist-form';
import { TherapistList } from './therapists/therapist-list';

/**
 * Rendering assertions for the therapist screens.
 *
 * Rendered to static markup and inspected as a string, matching the other page
 * tests: there is no client JavaScript to drive, so the markup is the whole
 * behaviour. Most of what is asserted here is structural — that a state change
 * is a form and not a link, that an inactive service stays checked and marked,
 * that no credential field exists — because those are the properties that would
 * regress silently.
 */

const CSRF = 'synthetic-csrf-token';

const ACTIVE_SERVICE: Service = {
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  name: 'Synthetic Service',
  publicDescription: null,
  isPublic: false,
  status: 'ACTIVE',
  deactivatedAt: null,
  allowedDurationsMinutes: [45],
  createdAt: '2026-08-05T00:00:00.000Z',
};

const INACTIVE_SERVICE: Service = {
  ...ACTIVE_SERVICE,
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
  name: 'Retired Service',
  status: 'INACTIVE',
  deactivatedAt: '2026-08-05T00:00:00.000Z',
};

const THERAPIST: Therapist = {
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a60',
  fullName: 'Synthetic Therapist',
  specialty: 'Synthetic Specialty',
  status: 'ACTIVE',
  deactivatedAt: null,
  supportedServiceIds: [],
  createdAt: '2026-08-05T00:00:00.000Z',
};

describe('therapist list', () => {
  const markup = renderToStaticMarkup(
    createElement(TherapistList, {
      therapists: [
        { ...THERAPIST, supportedServiceIds: [ACTIVE_SERVICE.id] },
        {
          ...THERAPIST,
          id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a61',
          fullName: 'Retired Therapist',
          status: 'INACTIVE',
          deactivatedAt: '2026-08-05T00:00:00.000Z',
        },
      ],
      services: [ACTIVE_SERVICE],
      csrfToken: CSRF,
      errorMessage: null,
    }),
  );

  it('shows the name, specialty and status of each therapist', () => {
    expect(markup).toContain('Synthetic Therapist');
    expect(markup).toContain('Synthetic Specialty');
    expect(markup).toContain('Retired Therapist');
    expect(markup).toContain('فعال');
    expect(markup).toContain('غیرفعال');
  });

  it('names the supported services rather than showing ids', () => {
    expect(markup).toContain('Synthetic Service');
    expect(markup).not.toContain(ACTIVE_SERVICE.id);
  });

  it('says plainly when a therapist has no assigned services', () => {
    const empty = renderToStaticMarkup(
      createElement(TherapistList, {
        therapists: [THERAPIST],
        services: [ACTIVE_SERVICE],
        csrfToken: CSRF,
        errorMessage: null,
      }),
    );

    // Not a blank cell: zero services is a normal state for a new record.
    expect(empty).toContain('خدمتی برای این درمانگر ثبت نشده است');
  });

  it('posts the status change to its own handler rather than linking', () => {
    expect(markup).toContain('action="/api/catalog/therapists/status"');
    expect(markup).toContain('method="post"');
    expect(markup).not.toContain('href="/api/catalog/therapists/status"');
  });

  it('offers the opposite status for each row', () => {
    expect(markup).toContain('value="INACTIVE"');
    expect(markup).toContain('value="ACTIVE"');
  });

  it('carries exactly one CSRF token per form', () => {
    const forms = markup.match(/<form/g)?.length ?? 0;
    const tokens = markup.match(new RegExp(`value="${CSRF}"`, 'g'))?.length ?? 0;

    expect(forms).toBeGreaterThan(0);
    expect(tokens).toBe(forms);
  });

  it('renders an empty state when there are no therapists', () => {
    const empty = renderToStaticMarkup(
      createElement(TherapistList, {
        therapists: [],
        services: [],
        csrfToken: CSRF,
        errorMessage: null,
      }),
    );

    expect(empty).toContain('هنوز درمانگری ثبت نشده است');
    expect(empty).toContain('/therapists/new');
  });

  it('announces an error with role="alert"', () => {
    const failed = renderToStaticMarkup(
      createElement(TherapistList, {
        therapists: [],
        services: [],
        csrfToken: CSRF,
        errorMessage: 'خطای نمونه',
      }),
    );

    expect(failed).toContain('role="alert"');
    expect(failed).toContain('خطای نمونه');
  });

  it('exposes no delete control', () => {
    expect(markup).not.toContain('حذف');
    expect(markup).not.toMatch(/method="delete"/i);
  });
});

describe('therapist form', () => {
  const createMarkup = renderToStaticMarkup(
    createElement(TherapistForm, {
      services: [ACTIVE_SERVICE, INACTIVE_SERVICE],
      csrfToken: CSRF,
      errorMessage: null,
    }),
  );

  const editMarkup = renderToStaticMarkup(
    createElement(TherapistForm, {
      therapist: { ...THERAPIST, supportedServiceIds: [INACTIVE_SERVICE.id] },
      services: [ACTIVE_SERVICE, INACTIVE_SERVICE],
      csrfToken: CSRF,
      errorMessage: null,
    }),
  );

  it('labels every control', () => {
    for (const id of ['fullName', 'specialty']) {
      expect(createMarkup).toContain(`for="${id}"`);
      expect(createMarkup).toContain(`id="${id}"`);
    }
  });

  it('offers services as checkboxes inside a labelled group', () => {
    // Checkboxes rather than a multi-select: every option is visible, reachable
    // by tab and space, and usable on a phone without a modifier key.
    expect(createMarkup).toContain('<fieldset');
    expect(createMarkup).toContain('<legend');
    expect(createMarkup).toContain('type="checkbox"');
    expect(createMarkup).toContain('name="serviceIds"');
    expect(createMarkup).not.toContain('multiple');
  });

  it('posts to create or update depending on whether it has a therapist', () => {
    expect(createMarkup).toContain('action="/api/catalog/therapists/create"');
    expect(editMarkup).toContain('action="/api/catalog/therapists/update"');
    expect(editMarkup).toContain(`value="${THERAPIST.id}"`);
  });

  it('prefills the existing values when editing', () => {
    expect(editMarkup).toContain('value="Synthetic Therapist"');
    expect(editMarkup).toContain('value="Synthetic Specialty"');
  });

  /**
   * Attribute order in the rendered tag is React's business, not this test's,
   * so the whole input element is extracted and inspected rather than matched
   * with a regex that assumes `value` precedes `checked`.
   */
  function inputFor(markup: string, serviceId: string): string {
    return markup.match(new RegExp(`<input[^>]*id="service-${serviceId}"[^>]*>`))?.[0] ?? '';
  }

  it('leaves every service unchecked on a new therapist', () => {
    // Submitting with none selected is valid, so nothing is pre-ticked.
    for (const service of [ACTIVE_SERVICE, INACTIVE_SERVICE]) {
      const input = inputFor(createMarkup, service.id);
      expect(input).not.toBe('');
      expect(input).not.toContain('checked');
    }
  });

  it('keeps an inactive service listed, checked and marked', () => {
    expect(editMarkup).toContain('Retired Service');
    expect(inputFor(editMarkup, INACTIVE_SERVICE.id)).toContain('checked');
    expect(editMarkup).toContain('خدمت غیرفعال');
  });

  it('leaves an unassociated service unchecked when editing', () => {
    expect(inputFor(editMarkup, ACTIVE_SERVICE.id)).not.toContain('checked');
  });

  it('does not mark an active service as inactive', () => {
    const activeOnly = renderToStaticMarkup(
      createElement(TherapistForm, {
        services: [ACTIVE_SERVICE],
        csrfToken: CSRF,
        errorMessage: null,
      }),
    );

    expect(activeOnly).not.toContain('خدمت غیرفعال');
  });

  it('explains itself and still saves when no service exists yet', () => {
    const markup = renderToStaticMarkup(
      createElement(TherapistForm, { services: [], csrfToken: CSRF, errorMessage: null }),
    );

    expect(markup).toContain('هنوز خدمتی ثبت نشده است');
    expect(markup).not.toContain('name="serviceIds"');
    // The submit button is still there: a therapist with no services is valid.
    expect(markup).toContain('type="submit"');
  });

  it('wires help text through aria-describedby', () => {
    expect(createMarkup).toContain('aria-describedby="fullName-help"');
    expect(createMarkup).toContain('id="fullName-help"');
  });

  it('exposes no credential, contact or settlement field', () => {
    // A therapist is a record staff manage, not an account, and settlement is a
    // later milestone with its own effective-dated shape.
    for (const forbidden of [
      'password',
      'username',
      'type="email"',
      'name="email"',
      'name="phone"',
      'nationalId',
      'sharePercentage',
      'settlement',
    ]) {
      expect(createMarkup).not.toContain(forbidden);
      expect(editMarkup).not.toContain(forbidden);
    }
  });

  it('blocks neither paste nor autofill', () => {
    expect(createMarkup).not.toContain('autocomplete="off"');
    expect(createMarkup).not.toContain('onpaste');
  });
});
