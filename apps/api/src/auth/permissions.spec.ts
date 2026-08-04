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

  it('gives a receptionist none', () => {
    // Deliberate, not an oversight: a receptionist's access in Milestone 1 is
    // the self-service endpoints, which need authentication but no permission.
    expect(permissionsForRole('RECEPTIONIST')).toEqual([]);
  });

  it('names only permissions that exist in the contract', () => {
    for (const granted of Object.values(ROLE_PERMISSIONS)) {
      for (const permission of granted) {
        expect(PERMISSIONS).toContain(permission);
      }
    }
  });
});
