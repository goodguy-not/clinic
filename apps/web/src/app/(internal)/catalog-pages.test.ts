import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Room, Service } from '@clinic/contracts';
import { RoomForm } from './rooms/room-form';
import { RoomList } from './rooms/room-list';
import { ServiceForm } from './services/service-form';
import { ServiceList } from './services/service-list';

/**
 * Rendering assertions for the catalog screens.
 *
 * Rendered to static markup and inspected as a string, matching the Milestone 1
 * page tests: there is no client JavaScript to drive, so the markup is the
 * whole behaviour. What these assert is mostly structural — that a state change
 * is a form and not a link, that every control has a label, that the room
 * restriction question is actually asked — because those are the properties
 * that would regress silently.
 */

const CSRF = 'synthetic-csrf-token';
const CATALOG_WRITE = { canCreate: true, canUpdate: true, canUpdateStatus: true } as const;

const SERVICE: Service = {
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  name: 'Synthetic Service',
  publicDescription: 'Synthetic description.',
  publicSlug: null,
  publicFirstPublishedAt: null,
  isPublic: true,
  status: 'ACTIVE',
  deactivatedAt: null,
  allowedDurationsMinutes: [30, 45],
  createdAt: '2026-08-05T00:00:00.000Z',
};

const INACTIVE_SERVICE: Service = {
  ...SERVICE,
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
  name: 'Retired Service',
  isPublic: false,
  status: 'INACTIVE',
  deactivatedAt: '2026-08-05T00:00:00.000Z',
};

const ROOM: Room = {
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a60',
  name: 'Synthetic Room',
  status: 'ACTIVE',
  deactivatedAt: null,
  allowedServiceIds: [],
  createdAt: '2026-08-05T00:00:00.000Z',
};

describe('service list', () => {
  const markup = renderToStaticMarkup(
    createElement(ServiceList, {
      services: [SERVICE, INACTIVE_SERVICE],
      csrfToken: CSRF,
      errorMessage: null,
      ...CATALOG_WRITE,
    }),
  );

  it('shows each service with its durations', () => {
    expect(markup).toContain('Synthetic Service');
    expect(markup).toContain('Retired Service');
    expect(markup).toContain('30');
    expect(markup).toContain('45');
  });

  it('posts the status change to its own handler rather than linking', () => {
    // A link would make deactivation reachable by a cross-site GET navigation.
    expect(markup).toContain('action="/api/catalog/services/status"');
    expect(markup).toContain('method="post"');
    expect(markup).not.toContain('href="/api/catalog/services/status"');
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

  it('renders an empty state instead of a bare table', () => {
    const empty = renderToStaticMarkup(
      createElement(ServiceList, {
        services: [],
        csrfToken: CSRF,
        errorMessage: null,
        ...CATALOG_WRITE,
      }),
    );

    expect(empty).toContain('هنوز خدمتی ثبت نشده است');
    expect(empty).toContain('/services/new');
  });

  it('announces an error with role="alert"', () => {
    const failed = renderToStaticMarkup(
      createElement(ServiceList, {
        services: [],
        csrfToken: CSRF,
        errorMessage: 'خطای نمونه',
        ...CATALOG_WRITE,
      }),
    );

    expect(failed).toContain('role="alert"');
    expect(failed).toContain('خطای نمونه');
  });
});

describe('service form', () => {
  const createMarkup = renderToStaticMarkup(
    createElement(ServiceForm, { csrfToken: CSRF, errorMessage: null }),
  );

  const editMarkup = renderToStaticMarkup(
    createElement(ServiceForm, { service: SERVICE, csrfToken: CSRF, errorMessage: null }),
  );

  it('labels every control', () => {
    for (const id of ['name', 'publicDescription', 'durations']) {
      expect(createMarkup).toContain(`for="${id}"`);
      expect(createMarkup).toContain(`id="${id}"`);
    }
  });

  it('asks the visibility question as a labelled group', () => {
    expect(createMarkup).toContain('<fieldset');
    expect(createMarkup).toContain('<legend');
    expect(createMarkup).toContain('name="isPublic"');
  });

  it('defaults a new service to internal only', () => {
    // Publishing has to be chosen, never inherited from a default.
    const privateOption = /id="isPublic-false"[^>]*checked/.test(createMarkup);
    expect(privateOption).toBe(true);
  });

  it('posts to create or update depending on whether it has a service', () => {
    expect(createMarkup).toContain('action="/api/catalog/services/create"');
    expect(editMarkup).toContain('action="/api/catalog/services/update"');
    expect(editMarkup).toContain(`value="${SERVICE.id}"`);
  });

  it('prefills the existing values when editing', () => {
    expect(editMarkup).toContain('value="Synthetic Service"');
    expect(editMarkup).toContain('Synthetic description.');
  });

  it('warns on the edit form that a priced duration cannot be removed', () => {
    // The rule is enforced by the database; the form has to say so before a
    // manager tries it, not only after the error comes back.
    expect(editMarkup).toContain('تعرفه');
    expect(createMarkup).not.toContain('تعرفه');
  });

  it('wires help text through aria-describedby', () => {
    expect(createMarkup).toContain('aria-describedby="name-help"');
    expect(createMarkup).toContain('id="name-help"');
  });
});

describe('room list', () => {
  it('names the services a restricted room allows', () => {
    const markup = renderToStaticMarkup(
      createElement(RoomList, {
        rooms: [{ ...ROOM, allowedServiceIds: [SERVICE.id] }],
        services: [SERVICE],
        csrfToken: CSRF,
        errorMessage: null,
        ...CATALOG_WRITE,
      }),
    );

    // Names, not ids: an id tells a manager nothing.
    expect(markup).toContain('Synthetic Service');
    expect(markup).not.toContain(SERVICE.id);
  });

  it('says explicitly when a room is unrestricted', () => {
    const markup = renderToStaticMarkup(
      createElement(RoomList, {
        rooms: [ROOM],
        services: [SERVICE],
        csrfToken: CSRF,
        errorMessage: null,
        ...CATALOG_WRITE,
      }),
    );

    expect(markup).toContain('همهٔ خدمات');
  });

  it('posts the status change to its own handler', () => {
    const markup = renderToStaticMarkup(
      createElement(RoomList, {
        rooms: [ROOM],
        services: [],
        csrfToken: CSRF,
        errorMessage: null,
        ...CATALOG_WRITE,
      }),
    );

    expect(markup).toContain('action="/api/catalog/rooms/status"');
    expect(markup).not.toContain('href="/api/catalog/rooms/status"');
  });

  it('keeps rows readable while hiding write controls without write permissions', () => {
    const serviceMarkup = renderToStaticMarkup(
      createElement(ServiceList, {
        services: [SERVICE],
        csrfToken: CSRF,
        errorMessage: null,
        canCreate: false,
        canUpdate: false,
        canUpdateStatus: false,
      }),
    );
    const roomMarkup = renderToStaticMarkup(
      createElement(RoomList, {
        rooms: [ROOM],
        services: [SERVICE],
        csrfToken: CSRF,
        errorMessage: null,
        canCreate: false,
        canUpdate: false,
        canUpdateStatus: false,
      }),
    );

    expect(serviceMarkup).toContain('Synthetic Service');
    expect(serviceMarkup).not.toContain('/services/new');
    expect(serviceMarkup).not.toContain('/services/status');
    expect(serviceMarkup).not.toContain('/edit');
    expect(roomMarkup).toContain('Synthetic Room');
    expect(roomMarkup).not.toContain('/rooms/new');
    expect(roomMarkup).not.toContain('/rooms/status');
    expect(roomMarkup).not.toContain('/edit');
  });
});

describe('room form', () => {
  const createMarkup = renderToStaticMarkup(
    createElement(RoomForm, { services: [SERVICE], csrfToken: CSRF, errorMessage: null }),
  );

  it('asks the restriction question explicitly rather than inferring it', () => {
    // An empty multi-select and "no restriction" are the same thing in the
    // data, so the interface has to be what distinguishes them.
    expect(createMarkup).toContain('name="restriction"');
    expect(createMarkup).toContain('value="all"');
    expect(createMarkup).toContain('value="selected"');
    expect(createMarkup).toContain('قابل استفاده برای همهٔ خدمات');
    expect(createMarkup).toContain('محدود به خدمات انتخاب‌شده');
  });

  it('defaults a new room to unrestricted', () => {
    expect(/id="restriction-all"[^>]*checked/.test(createMarkup)).toBe(true);
  });

  it('preselects restricted when the room already has restrictions', () => {
    const markup = renderToStaticMarkup(
      createElement(RoomForm, {
        room: { ...ROOM, allowedServiceIds: [SERVICE.id] },
        services: [SERVICE],
        csrfToken: CSRF,
        errorMessage: null,
      }),
    );

    expect(/id="restriction-selected"[^>]*checked/.test(markup)).toBe(true);
    expect(markup).toMatch(new RegExp(`value="${SERVICE.id}"[^>]*selected`));
  });

  it('offers a multiple select so several services can be chosen', () => {
    expect(createMarkup).toContain('multiple');
    expect(createMarkup).toContain('name="serviceIds"');
  });

  it('explains itself when there is no service to restrict to', () => {
    const markup = renderToStaticMarkup(
      createElement(RoomForm, { services: [], csrfToken: CSRF, errorMessage: null }),
    );

    expect(markup).toContain('هنوز خدمتی ثبت نشده است');
    expect(markup).not.toContain('name="serviceIds"');
  });

  it('keeps an inactive service selectable, so a restriction is not silently lost', () => {
    const markup = renderToStaticMarkup(
      createElement(RoomForm, {
        room: { ...ROOM, allowedServiceIds: [INACTIVE_SERVICE.id] },
        services: [SERVICE, INACTIVE_SERVICE],
        csrfToken: CSRF,
        errorMessage: null,
      }),
    );

    expect(markup).toContain('Retired Service');
    expect(markup).toMatch(new RegExp(`value="${INACTIVE_SERVICE.id}"[^>]*selected`));
  });
});

describe('no page blocks paste or autofill', () => {
  it.each([
    [
      'service form',
      renderToStaticMarkup(createElement(ServiceForm, { csrfToken: CSRF, errorMessage: null })),
    ],
    [
      'room form',
      renderToStaticMarkup(
        createElement(RoomForm, { services: [SERVICE], csrfToken: CSRF, errorMessage: null }),
      ),
    ],
  ])('%s', (_label, markup) => {
    expect(markup).not.toContain('autocomplete="off"');
    expect(markup).not.toContain('onpaste');
  });
});
