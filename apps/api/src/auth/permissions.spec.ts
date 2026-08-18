import { PERMISSIONS, USER_ROLES } from '@clinic/contracts';
import {
  DASHBOARD_READ_PERMISSIONS,
  FAMILY_ACCOUNT_READ_PERMISSIONS,
  FAMILY_ACCOUNT_REPORT_EXPORT_PERMISSIONS,
  FAMILY_ACCOUNT_REPORT_READ_PERMISSIONS,
  PAYMENT_REPORT_EXPORT_PERMISSIONS,
  PAYMENT_REPORT_READ_PERMISSIONS,
  PROMISE_REPORT_EXPORT_PERMISSIONS,
  ROLE_PERMISSIONS,
  SESSION_REPORT_EXPORT_PERMISSIONS,
  THERAPIST_ACTIVITY_EXPORT_PERMISSIONS,
  permissionsForRole,
} from './permissions';

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

  it('gives a receptionist exactly the family, child and booking workflow', () => {
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
        // Milestone 4: choosing a service, a therapist and a room, seeing when
        // that therapist works and what the session costs, and running the diary.
        'therapist.read',
        'service.read',
        'room.read',
        'tariff.read',
        'availability.read',
        'appointment.read',
        'appointment.create',
        'appointment.update',
        'appointment.cancel',
        'appointment.complete',
        'appointment.override_availability',
        // Milestone 5: reading the family account and raising the charge for a
        // session that happened. Voiding and adjusting are the manager's.
        'charge.read',
        'charge.post',
        // Milestone 6: taking the money and recording the promise. Voiding a
        // payment is the manager's.
        'payment.read',
        'payment.create',
        'promise.read',
        'promise.create',
        'promise.resolve',
      ].sort(),
    );
  });

  it('gives a receptionist no user, session, catalog-write, tariff or security permission', () => {
    // The negative half, and the half that matters. PROJECT_SPEC.md 4 bars a
    // receptionist from global tariff CHANGES and from security administration.
    // The Milestone 4 catalog grants are reads only: every catalog write —
    // `tariff.create` and `tariff.void` included — and every user or session
    // authority stays with the manager.
    const granted = permissionsForRole('RECEPTIONIST');

    for (const forbidden of [
      'user.read',
      'user.create',
      'user.update_role',
      'user.update_status',
      'user.reset_password',
      'user.unlock',
      'session.revoke_any',
      'therapist.create',
      'therapist.update',
      'therapist.update_status',
      'service.create',
      'service.update',
      'service.update_status',
      'room.create',
      'room.update',
      'room.update_status',
      'tariff.create',
      'tariff.void',
      'availability.manage',
      'charge.void',
      'charge.adjust',
      'payment.void',
      // Milestone 7: the clinic's whole financial position, and carrying a file
      // out of the system.
      'report.read_financial',
      'report.export',
    ] as const) {
      expect(granted).not.toContain(forbidden);
    }
  });

  describe('the ledger', () => {
    // PROJECT_SPEC.md 4 keeps financial corrections away from the receptionist,
    // and DECISION_LOG 2026-08-14 settles that as four permissions rather than
    // one: posting is the ordinary end of completing a session, and withdrawing
    // or reducing a charge is a correction.
    it('grants a manager all four charge permissions', () => {
      for (const permission of [
        'charge.read',
        'charge.post',
        'charge.void',
        'charge.adjust',
      ] as const) {
        expect(permissionsForRole('MANAGER')).toContain(permission);
      }
    });

    it('grants a receptionist exactly the two that raise no correction', () => {
      const granted = permissionsForRole('RECEPTIONIST');

      expect(granted).toContain('charge.read');
      expect(granted).toContain('charge.post');
      expect(granted).not.toContain('charge.void');
      expect(granted).not.toContain('charge.adjust');
    });

    it('defines exactly four charge permissions, and no time-boxed variant', () => {
      // Authority that expires is authority whose last day is the day a mistake
      // becomes unfixable by the person who made it; the same-day window
      // PROJECT_SPEC.md 15 left open was declined.
      expect(PERMISSIONS.filter((permission) => permission.startsWith('charge.')).sort()).toEqual(
        ['charge.adjust', 'charge.post', 'charge.read', 'charge.void'].sort(),
      );
    });
  });

  describe('money in', () => {
    // DECISION_LOG, 2026-08-15: payment void is manager-only, and a promise —
    // which moves no money in any state — is entirely the receptionist's.
    it('defines exactly six permissions, and no time-boxed variant', () => {
      expect(
        PERMISSIONS.filter((permission) => /^(?:payment|promise)\./.test(permission)).sort(),
      ).toEqual(
        [
          'payment.read',
          'payment.create',
          'payment.void',
          'promise.read',
          'promise.create',
          'promise.resolve',
        ].sort(),
      );

      for (const absent of [
        'payment.void_same_day',
        'payment.update',
        'promise.fulfill',
        'promise.reschedule',
        'promise.cancel',
        'credit.manage',
      ] as const) {
        expect(PERMISSIONS).not.toContain(absent as never);
      }
    });

    it('grants a manager all six', () => {
      for (const permission of [
        'payment.read',
        'payment.create',
        'payment.void',
        'promise.read',
        'promise.create',
        'promise.resolve',
      ] as const) {
        expect(permissionsForRole('MANAGER')).toContain(permission);
      }
    });

    it('grants a receptionist everything except reversing a payment', () => {
      const granted = permissionsForRole('RECEPTIONIST');

      expect(granted).toContain('payment.read');
      expect(granted).toContain('payment.create');
      expect(granted).toContain('promise.read');
      expect(granted).toContain('promise.create');
      expect(granted).toContain('promise.resolve');
      expect(granted).not.toContain('payment.void');
    });

    it('requires all three financial reads to read a family account', () => {
      // The response carries the charges, the whole-family payment position and
      // the open and overdue promise counts, so the route names every authority
      // it reads. AND semantics: `PermissionsGuard` requires every permission in
      // the list, so a future role holding one and not the others is refused
      // rather than served a partial account.
      expect([...FAMILY_ACCOUNT_READ_PERMISSIONS].sort()).toEqual(
        ['charge.read', 'payment.read', 'promise.read'].sort(),
      );

      for (const permission of FAMILY_ACCOUNT_READ_PERMISSIONS) {
        expect(PERMISSIONS).toContain(permission);
      }
    });

    it('changes nobody access today, because both roles hold all three', () => {
      for (const role of ['MANAGER', 'RECEPTIONIST'] as const) {
        const granted = permissionsForRole(role);

        for (const permission of FAMILY_ACCOUNT_READ_PERMISSIONS) {
          expect(granted).toContain(permission);
        }
      }
    });
  });

  describe('reporting', () => {
    // Milestone 7. The operational reads reuse the authorities that already
    // describe the data; the two new names are the clinic-wide financial read
    // and the export, and both are the manager's.
    it('defines exactly two report permissions, and none for the operational reads', () => {
      expect(PERMISSIONS.filter((permission) => permission.startsWith('report.')).sort()).toEqual(
        ['report.read_financial', 'report.export'].sort(),
      );

      // Each of these would be a second name for an authority that already
      // exists, and a role map would have to keep the two in step forever.
      for (const absent of [
        'report.read',
        'report.read_sessions',
        'report.read_promises',
        'report.read_therapist_activity',
        'dashboard.read',
      ] as const) {
        expect(PERMISSIONS).not.toContain(absent as never);
      }
    });

    it('grants a manager both, and a receptionist neither', () => {
      for (const permission of ['report.read_financial', 'report.export'] as const) {
        expect(permissionsForRole('MANAGER')).toContain(permission);
        expect(permissionsForRole('RECEPTIONIST')).not.toContain(permission);
      }
    });

    it('lets both roles read the dashboard, under four authorities they already hold', () => {
      // The shared operational screen. Nothing here is new access: the point of
      // the list is that the route names every module it aggregates.
      expect([...DASHBOARD_READ_PERMISSIONS].sort()).toEqual(
        ['appointment.read', 'charge.read', 'payment.read', 'promise.read'].sort(),
      );

      // `charge.read` IS PART OF IT, and its absence would be a side channel.
      // `unchargedCompletedSessionCount` is `session_charge` read through the
      // ledger's own valid-charge predicate, so a role holding the diary and the
      // promise workflow but not the ledger would otherwise learn, seat by seat,
      // which of the clinic's sessions are unbilled.
      expect(DASHBOARD_READ_PERMISSIONS).toContain('charge.read');

      // AND STILL NO REPORT PERMISSION. The dashboard is the operational reads a
      // receptionist already holds, aggregated for one day; `report.read_financial`
      // selects the clinic-wide RESPONSE VARIANT and does not gate the route.
      expect(DASHBOARD_READ_PERMISSIONS).not.toContain('report.read_financial');
      expect(DASHBOARD_READ_PERMISSIONS).not.toContain('report.export');

      for (const role of ['MANAGER', 'RECEPTIONIST'] as const) {
        for (const permission of DASHBOARD_READ_PERMISSIONS) {
          expect(permissionsForRole(role)).toContain(permission);
        }
      }
    });

    it('puts the clinic-wide financial reports behind an authority a receptionist lacks', () => {
      // The leak this prevents: `payment.read` is what a receptionist records
      // money with, and it must not become "every family's money, and what each
      // colleague took in".
      expect([...PAYMENT_REPORT_READ_PERMISSIONS].sort()).toEqual(
        ['payment.read', 'report.read_financial'].sort(),
      );
      expect([...FAMILY_ACCOUNT_REPORT_READ_PERMISSIONS].sort()).toEqual(
        ['charge.read', 'payment.read', 'promise.read', 'report.read_financial'].sort(),
      );

      // The single-family account read stays exactly as it was: the report list
      // is that list plus the clinic-wide authority, not a different one.
      for (const permission of FAMILY_ACCOUNT_READ_PERMISSIONS) {
        expect(FAMILY_ACCOUNT_REPORT_READ_PERMISSIONS).toContain(permission);
      }

      const receptionist = permissionsForRole('RECEPTIONIST');
      for (const list of [
        PAYMENT_REPORT_READ_PERMISSIONS,
        FAMILY_ACCOUNT_REPORT_READ_PERMISSIONS,
      ]) {
        expect(list.every((permission) => receptionist.includes(permission))).toBe(false);
        expect(list.every((permission) => permissionsForRole('MANAGER').includes(permission))).toBe(
          true,
        );
      }
    });

    it('names only permissions that exist, in every report authority set', () => {
      for (const list of [
        DASHBOARD_READ_PERMISSIONS,
        PAYMENT_REPORT_READ_PERMISSIONS,
        FAMILY_ACCOUNT_REPORT_READ_PERMISSIONS,
        SESSION_REPORT_EXPORT_PERMISSIONS,
        PROMISE_REPORT_EXPORT_PERMISSIONS,
        THERAPIST_ACTIVITY_EXPORT_PERMISSIONS,
        PAYMENT_REPORT_EXPORT_PERMISSIONS,
        FAMILY_ACCOUNT_REPORT_EXPORT_PERMISSIONS,
      ]) {
        for (const permission of list) expect(PERMISSIONS).toContain(permission);
      }
    });

    describe('the CSV exports (checkpoint C5)', () => {
      const exportSets = [
        SESSION_REPORT_EXPORT_PERMISSIONS,
        PROMISE_REPORT_EXPORT_PERMISSIONS,
        THERAPIST_ACTIVITY_EXPORT_PERMISSIONS,
        PAYMENT_REPORT_EXPORT_PERMISSIONS,
        FAMILY_ACCOUNT_REPORT_EXPORT_PERMISSIONS,
      ];

      it('refuses a receptionist every export, including the reports they may read', () => {
        // The frozen owner decision: export is manager-only. A receptionist reads
        // sessions, promises and therapist activity on the screen all day and may
        // carry none of them out of the building, because `report.export` is a
        // name they have never held.
        const receptionist = permissionsForRole('RECEPTIONIST');

        for (const list of exportSets) {
          expect(list).toContain('report.export');
          expect(list.every((permission) => receptionist.includes(permission))).toBe(false);
          expect(
            list.every((permission) => permissionsForRole('MANAGER').includes(permission)),
          ).toBe(true);
        }
      });

      it('names each report own read authorities as well, so revoking a read revokes its file', () => {
        // `report.export` alone would be the widest door in the building: one
        // permission opening every report regardless of what its holder may look
        // at. Each list is its report READ list plus the export authority.
        expect(SESSION_REPORT_EXPORT_PERMISSIONS).toContain('appointment.read');
        expect(PROMISE_REPORT_EXPORT_PERMISSIONS).toContain('promise.read');
        expect(THERAPIST_ACTIVITY_EXPORT_PERMISSIONS).toContain('appointment.read');

        for (const permission of PAYMENT_REPORT_READ_PERMISSIONS) {
          expect(PAYMENT_REPORT_EXPORT_PERMISSIONS).toContain(permission);
        }
        for (const permission of FAMILY_ACCOUNT_REPORT_READ_PERMISSIONS) {
          expect(FAMILY_ACCOUNT_REPORT_EXPORT_PERMISSIONS).toContain(permission);
        }
      });

      it('introduces no new permission name for exporting', () => {
        // C5 spends the authority C1 froze and adds none: `report.export` was
        // settled when the permission model was, and the CSV is what uses it.
        expect(PERMISSIONS.filter((permission) => permission.startsWith('report.'))).toEqual([
          'report.read_financial',
          'report.export',
        ]);
      });
    });
  });

  it('lets a receptionist book outside availability, which is an authority of its own', () => {
    // The approved override: the person running the diary is the person a
    // therapist tells "I will come in for this one" (PROJECT_SPEC.md 5). It is
    // granted separately from `appointment.create` so it stays visible in the map
    // and revocable on its own, and the service still requires a recorded reason.
    expect(permissionsForRole('RECEPTIONIST')).toContain('appointment.override_availability');
    expect(permissionsForRole('MANAGER')).toContain('appointment.override_availability');
  });

  it('never lets a receptionist reverse a completion', () => {
    // Reopening a completed session voids or offsets a financial record, which
    // PROJECT_SPEC.md 4 keeps away from this role.
    expect(permissionsForRole('RECEPTIONIST')).not.toContain('appointment.reopen');
    expect(permissionsForRole('MANAGER')).toContain('appointment.reopen');
  });

  it('names only permissions that exist in the contract', () => {
    for (const granted of Object.values(ROLE_PERMISSIONS)) {
      for (const permission of granted) {
        expect(PERMISSIONS).toContain(permission);
      }
    }
  });
});
