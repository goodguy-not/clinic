import { PERMISSIONS, USER_ROLES } from '@clinic/contracts';
import { ROLE_PERMISSIONS, permissionsForRole } from './permissions';

describe('role to permission map', () => {
  it('covers every role in the shared contract', () => {
    // `Record<UserRole, ...>` makes this a compile error too; the test states
    // the same thing at runtime so a contract change cannot slip through a
    // stale build.
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...USER_ROLES].sort());
  });

  it('gives a manager every permission that exists', () => {
    expect([...permissionsForRole('MANAGER')].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('gives a receptionist exactly the family and child workflow', () => {
    // Stated as an exact list rather than a subset check: a permission
    // accidentally added to this role must fail here, not pass quietly.
    expect([...permissionsForRole('RECEPTIONIST')].sort()).toEqual(
      [
        'child.create',
        'child.read',
        'child.update',
        'child.update_status',
        'family.create',
        'family.read',
        'family.update',
        'family.update_status',
      ].sort(),
    );
  });

  it('gives a receptionist no user, session, catalog, tariff or security permission', () => {
    // The negative half. PROJECT_SPEC.md 4 bars a receptionist from global
    // tariff changes and from security administration, and no receptionist
    // workflow reads catalog data before Milestone 4.
    const granted = permissionsForRole('RECEPTIONIST');

    for (const permission of granted) {
      expect(permission).toMatch(/^(?:family|child)\./);
    }

    for (const forbidden of PERMISSIONS.filter(
      (permission) => !/^(?:family|child)\./.test(permission),
    )) {
      expect(granted).not.toContain(forbidden);
    }
  });

  it('names only permissions that exist in the contract', () => {
    for (const granted of Object.values(ROLE_PERMISSIONS)) {
      for (const permission of granted) {
        expect(PERMISSIONS).toContain(permission);
      }
    }
  });
});
