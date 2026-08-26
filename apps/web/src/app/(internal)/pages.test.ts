import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StaffUser } from '@clinic/contracts';
import { COPY } from '@/server/copy-fa';
import { ChangePasswordForm } from './change-password/change-password-form';
import { LoginForm } from './login/login-form';
import SessionExpiredPage from './session-expired/page';
import { StaffAdmin } from './staff/staff-admin';

/**
 * Rendered markup, not JSX.
 *
 * `createElement` keeps this file plain TypeScript, so the assertions do not
 * depend on the test runner's JSX transform. What is being checked is the HTML
 * a browser would receive.
 */
const CSRF = 'v1.nonce.9999999999.signature';

const MANAGER: StaffUser = {
  id: '019fcce9-0000-7000-8000-00000000aa01',
  username: 'synthetic.manager',
  displayName: 'Synthetic Manager',
  role: 'MANAGER',
  status: 'ACTIVE',
  mustChangePassword: false,
  lockedUntil: null,
  lastLoginAt: null,
  createdAt: '2026-08-04T10:00:00.000Z',
};

const RECEPTIONIST: StaffUser = {
  id: '019fcce9-0000-7000-8000-00000000aa02',
  username: 'synthetic.reception',
  displayName: 'Synthetic Receptionist',
  role: 'RECEPTIONIST',
  status: 'DISABLED',
  mustChangePassword: true,
  lockedUntil: '2026-08-04T11:00:00.000Z',
  lastLoginAt: null,
  createdAt: '2026-08-04T10:00:00.000Z',
};

describe('/login', () => {
  const markup = renderToStaticMarkup(
    createElement(LoginForm, { csrfToken: CSRF, errorMessage: null }),
  );

  it('renders the approved Persian title and field labels', () => {
    expect(markup).toContain(COPY.loginTitle);
    expect(markup).toContain(COPY.username);
    expect(markup).toContain(COPY.password);
    expect(markup).toContain(COPY.signIn);
  });

  it('posts to the explicit login handler', () => {
    expect(markup).toContain('method="post"');
    expect(markup).toContain('action="/api/auth/login"');
  });

  it('carries the server-rendered half of the double-submit pair', () => {
    expect(markup).toContain('name="csrfToken"');
    expect(markup).toContain(CSRF);
  });

  it('permits paste, autofill and password managers', () => {
    // Blocking paste stops password managers and pushes people towards short,
    // typeable passwords — the opposite of what a 15-character minimum is for.
    //
    // Matched case-insensitively: React 19 emits the camelCase `autoComplete`
    // verbatim rather than lowercasing it. HTML attribute names are
    // case-insensitive, so browsers and password managers honour it either way.
    expect(markup).toMatch(/autocomplete="username"/i);
    expect(markup).toMatch(/autocomplete="current-password"/i);
    expect(markup).not.toMatch(/autocomplete="off"/i);
    expect(markup).not.toMatch(/onpaste|oncopy/i);
  });

  it('duplicates no password policy in the browser', () => {
    expect(markup).not.toMatch(/minlength|pattern=/i);
    expect(markup).not.toContain('۱۵');
  });

  it('shows the approved generic failure when one is passed', () => {
    const withError = renderToStaticMarkup(
      createElement(LoginForm, { csrfToken: CSRF, errorMessage: COPY.loginFailed }),
    );

    expect(withError).toContain(COPY.loginFailed);
    expect(withError).toContain('role="alert"');
  });
});

describe('/change-password', () => {
  const markup = renderToStaticMarkup(
    createElement(ChangePasswordForm, { csrfToken: CSRF, errorMessage: null, forced: false }),
  );

  it('renders the approved password guidance verbatim', () => {
    expect(markup).toContain(COPY.passwordGuidance);
    expect(COPY.passwordGuidance).toContain('۱۵');
  });

  it('offers current, new and confirmation fields', () => {
    expect(markup).toContain('name="currentPassword"');
    expect(markup).toContain('name="newPassword"');
    expect(markup).toContain('name="confirmPassword"');
  });

  it('carries a CSRF token and posts to the password handler', () => {
    expect(markup).toContain('action="/api/auth/password"');
    expect(markup).toContain(CSRF);
  });

  it('associates the guidance with the new-password field for screen readers', () => {
    expect(markup).toContain('aria-describedby="password-guidance"');
    expect(markup).toContain('id="password-guidance"');
  });

  it('permits password managers on both new-password fields', () => {
    expect(markup.match(/autocomplete="new-password"/gi)).toHaveLength(2);
    expect(markup).not.toMatch(/autocomplete="off"/i);
  });

  it('explains a forced change when one is outstanding', () => {
    const forced = renderToStaticMarkup(
      createElement(ChangePasswordForm, { csrfToken: CSRF, errorMessage: null, forced: true }),
    );

    expect(forced).toContain(COPY.mustChangePassword);
  });
});

describe('/session-expired', () => {
  const markup = renderToStaticMarkup(createElement(SessionExpiredPage));

  it('renders the approved message and button copy', () => {
    expect(markup).toContain(COPY.sessionExpired);
    expect(markup).toContain(COPY.sessionExpiredButton);
  });

  it('recovers through a form post, never a link or an automatic GET', () => {
    // Clearing a session cookie is a state change, and SameSite=Lax would send
    // cookies on a cross-site top-level GET navigation.
    expect(markup).toContain('method="post"');
    expect(markup).toContain('action="/api/auth/session-reset"');
    expect(markup).not.toContain('<a ');
  });
});

describe('/staff', () => {
  const markup = renderToStaticMarkup(
    createElement(StaffAdmin, {
      users: [MANAGER, RECEPTIONIST],
      csrfToken: CSRF,
      errorMessage: null,
      currentUserId: MANAGER.id,
    }),
  );

  it('renders the Persian administration copy', () => {
    expect(markup).toContain(COPY.staffTitle);
    expect(markup).toContain(COPY.staffCreateTitle);
    expect(markup).toContain(COPY.roleManager);
    expect(markup).toContain(COPY.roleReceptionist);
  });

  it('lists staff with their role, status and lock state', () => {
    expect(markup).toContain('synthetic.manager');
    expect(markup).toContain('synthetic.reception');
    expect(markup).toContain(COPY.statusActive);
    expect(markup).toContain(COPY.statusDisabled);
  });

  it('posts every action to its own explicit handler', () => {
    for (const action of [
      '/api/staff/create',
      '/api/staff/role',
      '/api/staff/status',
      '/api/staff/password-reset',
      '/api/staff/unlock',
      '/api/staff/revoke-sessions',
    ]) {
      expect(markup).toContain(`action="${action}"`);
    }
  });

  it('includes a CSRF token in every form', () => {
    const forms = markup.match(/<form/g) ?? [];
    const tokens = markup.match(/name="csrfToken"/g) ?? [];

    expect(forms.length).toBeGreaterThan(0);
    expect(tokens).toHaveLength(forms.length);
  });

  it('offers no role or status action against the signed-in user', () => {
    // NestJS refuses a self-change; not offering it avoids presenting an action
    // that cannot succeed. Two users, one of them the caller, so exactly one
    // role form and one status form should exist.
    expect(markup.match(/action="\/api\/staff\/role"/g)).toHaveLength(1);
    expect(markup.match(/action="\/api\/staff\/status"/g)).toHaveLength(1);

    // The actions that are safe against oneself are offered for both.
    expect(markup.match(/action="\/api\/staff\/unlock"/g)).toHaveLength(2);
  });

  it('never renders a temporary password', () => {
    // Creation and reset return theirs in the body of the POST response, so it
    // never reaches a URL, history, storage or analytics.
    expect(markup).not.toContain(COPY.temporaryPasswordTitle);
  });
});
