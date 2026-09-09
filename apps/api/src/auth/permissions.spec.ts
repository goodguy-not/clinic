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
  SETTLEMENT_EXPORT_PERMISSIONS,
  SETTLEMENT_RATING_CORRECTION_PERMISSIONS,
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
        // Milestone 9, checkpoint A2: DRAFTING public content, and reading the
        // drafts in order to edit them. Publishing an article and approving a
        // testimonial are withheld, and the negative half below states that.
        'article.read',
        'article.draft',
        'testimonial.read',
        'testimonial.draft',
        // Milestone 9, checkpoint A4: answering the clinic's contact form.
        // Reading the inbox, moving a request along the accepted lifecycle, and
        // linking one to a family this role can already register itself.
        'website_request.read',
        'website_request.process',
        // Milestone 9.5, checkpoint A5: the media library, minus the name that
        // makes a photograph visible. Uploading and attaching are front-desk
        // work and neither can put anything in front of a visitor; publishing,
        // unpublishing and archiving are `media.publish`, which is withheld and
        // which the negative half below states.
        'media.read',
        'media.upload',
        'media.attach',
        // Milestone 9.5, checkpoint A6: preparing public copy for a service and
        // for a colleague's profile. Publishing either is withheld, and the
        // negative half below states that alongside every operational name this
        // checkpoint deliberately did not move.
        'service.draft_public_copy',
        'therapist.draft_public_profile',
        // Milestone 9.5, checkpoint A7: reading and drafting the clinic's
        // public spaces. `public_space.publish` is withheld and the negative
        // half below states it, beside the operational room names this
        // checkpoint deliberately did not move.
        'public_space.read',
        'public_space.draft',
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
      // Milestone 8: what a THERAPIST earns. Every one of the seven, because
      // this role holds none of them.
      'therapist_share.read',
      'therapist_share.create',
      'therapist_share.void',
      'settlement.read',
      'settlement.rate',
      'settlement.void_rating',
      'settlement.close',
      // Milestone 9.5: the one media authority that changes what the world
      // sees. It covers publishing an attachment, unpublishing one, archiving
      // an asset and restoring it, and this role holds none of those.
      'media.publish',
      // Milestone 9.5, checkpoint A6: the authority that decides a named
      // colleague appears on a public website. Drafting their title and
      // biography is now this role's; deciding they are published is not.
      'therapist.publish_profile',
      // Milestone 9.5, checkpoint A7: the authority that puts a description of
      // the clinic's building on the website. Drafting one is now this role's;
      // publishing it is not.
      'public_space.publish',
    ] as const) {
      expect(granted).not.toContain(forbidden);
    }
  });

  describe('public spaces are not operational rooms', () => {
    // Milestone 9.5, checkpoint A7. THE WHOLE POINT OF THE CHECKPOINT, STATED
    // AS AUTHORITY. A public space is editorial content about the building; a
    // room is scheduling configuration. The permission model has to say so, or
    // "they are different concepts" is a claim with nothing enforcing it.
    it('carries exactly the three approved public-space names', () => {
      expect(
        PERMISSIONS.filter((permission) => permission.startsWith('public_space.')).sort(),
      ).toEqual(['public_space.draft', 'public_space.publish', 'public_space.read'].sort());
    });

    it('leaves the four room names exactly where they were', () => {
      // Not "a room permission was not added": the EXISTING four are unchanged,
      // and the receptionist still holds the read alone. A checkpoint that let
      // the front desk describe the waiting area must not have let them
      // configure the room it is next to.
      expect(PERMISSIONS.filter((permission) => permission.startsWith('room.')).sort()).toEqual(
        ['room.create', 'room.read', 'room.update', 'room.update_status'].sort(),
      );

      const granted = permissionsForRole('RECEPTIONIST');

      expect(granted).toContain('room.read');
      expect(granted).not.toContain('room.create');
      expect(granted).not.toContain('room.update');
      expect(granted).not.toContain('room.update_status');
    });

    it('splits drafting from publishing, as every other content permission does', () => {
      const granted = permissionsForRole('RECEPTIONIST');

      expect(granted).toContain('public_space.read');
      expect(granted).toContain('public_space.draft');
      expect(granted).not.toContain('public_space.publish');
      expect(permissionsForRole('MANAGER')).toContain('public_space.publish');
    });

    it('grants nothing operational, financial or scheduling', () => {
      // A7 widens no existing authority. Stated as an exact list of the names a
      // reader might fear a "spaces" checkpoint had quietly touched.
      const granted = permissionsForRole('RECEPTIONIST');

      for (const unchanged of [
        'room.create',
        'room.update',
        'room.update_status',
        'service.update',
        'service.update_status',
        'therapist.update',
        'therapist.publish_profile',
        'availability.manage',
        'tariff.create',
        'tariff.void',
        'appointment.reopen',
        'charge.void',
        'charge.adjust',
        'payment.void',
        'media.publish',
        'article.publish',
        'testimonial.approve',
      ] as const) {
        expect(granted).not.toContain(unchanged);
      }
    });
  });

  describe('the media subsystem', () => {
    // Milestone 9.5, checkpoint A5. The same draft-versus-publish boundary the
    // A2 content permissions drew, stated here so that widening it later has to
    // be a deliberate edit to a test rather than a quiet edit to a role map.
    it('carries exactly the four approved media names', () => {
      expect(PERMISSIONS.filter((permission) => permission.startsWith('media.')).sort()).toEqual(
        ['media.attach', 'media.publish', 'media.read', 'media.upload'].sort(),
      );
    });

    it('lets a receptionist prepare a photograph and never publish one', () => {
      const granted = permissionsForRole('RECEPTIONIST');

      expect(granted).toContain('media.read');
      expect(granted).toContain('media.upload');
      expect(granted).toContain('media.attach');
      expect(granted).not.toContain('media.publish');
    });

    it('adds no media authority over anything that is not a photograph', () => {
      // The frozen boundary for this checkpoint: a receptionist may upload
      // media, and NO operational, financial, scheduling or clinical authority
      // moves with it. Stated against the names that would represent such a
      // widening, so that a future edit granting one fails here.
      const granted = permissionsForRole('RECEPTIONIST');

      for (const unchanged of [
        'article.publish',
        'testimonial.approve',
        'therapist.publish_profile',
        'clinic_profile.update',
        'charge.void',
        'appointment.reopen',
      ] as const) {
        expect(granted).not.toContain(unchanged);
      }
    });
  });

  describe('the editorial split (checkpoint A6)', () => {
    // The frozen boundary of this checkpoint, stated in both directions so that
    // widening it later has to be a deliberate edit to a test rather than a
    // quiet edit to a role map.
    it('carries exactly the two approved drafting names', () => {
      expect(
        PERMISSIONS.filter((permission) => permission.endsWith('draft_public_copy')).concat(
          PERMISSIONS.filter((permission) => permission.endsWith('draft_public_profile')),
        ),
      ).toEqual(['service.draft_public_copy', 'therapist.draft_public_profile']);
    });

    it('lets a receptionist prepare public copy and never publish it', () => {
      const granted = permissionsForRole('RECEPTIONIST');

      expect(granted).toContain('service.draft_public_copy');
      expect(granted).toContain('therapist.draft_public_profile');
      // The two names that promote a draft onto a live page. Neither moves.
      expect(granted).not.toContain('service.update');
      expect(granted).not.toContain('therapist.publish_profile');
    });

    it('moves no operational, financial, scheduling or personnel authority', () => {
      // The half of the frozen boundary that is about what did NOT change.
      // Durations, active status, restrictions, availability, tariffs,
      // settlement configuration and the personnel record are all reached by
      // names this role still does not hold.
      const granted = permissionsForRole('RECEPTIONIST');

      for (const unchanged of [
        'service.create',
        'service.update',
        'service.update_status',
        'therapist.create',
        'therapist.update',
        'therapist.update_status',
        'therapist.publish_profile',
        'tariff.create',
        'tariff.void',
        'availability.manage',
        'clinic_profile.read',
        'clinic_profile.update',
        'media.publish',
        'article.publish',
        'testimonial.approve',
      ] as const) {
        expect(granted).not.toContain(unchanged);
      }
    });

    it('gives a manager both drafting names as well', () => {
      // Drafting is not a lesser role's consolation prize: a manager writes
      // copy too, and the publication act is what is exclusive.
      const granted = permissionsForRole('MANAGER');

      expect(granted).toContain('service.draft_public_copy');
      expect(granted).toContain('therapist.draft_public_profile');
    });
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

    it('lets both roles read the dashboard, under five authorities they already hold', () => {
      // The shared operational screen. Nothing here is new access: the point of
      // the list is that the route names every module it aggregates.
      expect([...DASHBOARD_READ_PERMISSIONS].sort()).toEqual(
        [
          'appointment.read',
          'charge.read',
          'payment.read',
          'promise.read',
          // Milestone 9, checkpoint A4: `newWebsiteRequestCount` is
          // `website_request` counted, so the route names the authority to read
          // one. Both internal roles hold it, so nobody's access changed.
          'website_request.read',
        ].sort(),
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

  describe('therapist settlement', () => {
    // Milestone 8, checkpoint C1. The permission model is frozen before any
    // settlement behaviour exists, so the surfaces built against it in the later
    // checkpoints cannot each decide what authority they need.
    const SETTLEMENT_PERMISSIONS = [
      'therapist_share.read',
      'therapist_share.create',
      'therapist_share.void',
      'settlement.read',
      'settlement.rate',
      'settlement.void_rating',
      'settlement.close',
    ] as const;

    it('defines exactly the seven approved names', () => {
      expect(
        PERMISSIONS.filter((permission) =>
          /^(?:therapist_share|settlement)\./.test(permission),
        ).sort(),
      ).toEqual([...SETTLEMENT_PERMISSIONS].sort());
    });

    it('names nothing this milestone did not approve', () => {
      for (const absent of [
        // A share rule is never edited: a correction voids it and writes a
        // replacement, exactly as a tariff does.
        'therapist_share.update',
        // Rating and un-rating are two authorities on purpose — folding them into
        // one would make the correction's AND-list inexpressible.
        'settlement.manage',
        'settlement.write',
        // A closed period is never reopened, so there is no authority to do it.
        'settlement.reopen',
        // Taking the file out of the building is `report.export`, ANDed with the
        // settlement read. A second export name would be a second answer.
        'settlement.export',
        // Milestone 8 records no payout, so there is nothing to authorise.
        'settlement.pay',
        'therapist_payment.create',
        // A therapist has no account in this product.
        'settlement.read_own',
        'therapist.self_read',
      ] as const) {
        expect(PERMISSIONS).not.toContain(absent as never);
      }
    });

    it('gives every one of them to the manager and none of them to the receptionist', () => {
      const manager = permissionsForRole('MANAGER');
      const receptionist = permissionsForRole('RECEPTIONIST');

      for (const permission of SETTLEMENT_PERMISSIONS) {
        expect(manager).toContain(permission);
        expect(receptionist).not.toContain(permission);
      }
    });

    it('leaves the receptionist with no settlement name of any kind', () => {
      // The blanket half of the assertion above: not "none of these seven" but
      // "nothing in either namespace", so a future name added to the list cannot
      // reach this role by being granted before anybody notices.
      for (const permission of permissionsForRole('RECEPTIONIST')) {
        expect(permission).not.toMatch(/^(?:therapist_share|settlement)\./);
      }
    });

    it('exports a settlement statement under the read authority plus report.export', () => {
      // The Milestone 7 export shape, unchanged: the read AND the act. Revoking
      // `settlement.read` takes the file with it.
      expect([...SETTLEMENT_EXPORT_PERMISSIONS]).toEqual(['settlement.read', 'report.export']);

      for (const permission of SETTLEMENT_EXPORT_PERMISSIONS) {
        expect(PERMISSIONS).toContain(permission);
      }

      expect(
        SETTLEMENT_EXPORT_PERMISSIONS.every((permission) =>
          permissionsForRole('MANAGER').includes(permission),
        ),
      ).toBe(true);
      expect(
        SETTLEMENT_EXPORT_PERMISSIONS.every((permission) =>
          permissionsForRole('RECEPTIONIST').includes(permission),
        ),
      ).toBe(false);
    });

    it('requires both halves of the act to correct a rating', () => {
      // AND, not OR. The correction withdraws a rating and writes its
      // replacement in one transaction, so it names both authorities: a caller
      // who may rate but not withdraw must not reach it, and neither must one who
      // may withdraw but not rate.
      expect([...SETTLEMENT_RATING_CORRECTION_PERMISSIONS]).toEqual([
        'settlement.void_rating',
        'settlement.rate',
      ]);

      for (const permission of SETTLEMENT_RATING_CORRECTION_PERMISSIONS) {
        expect(PERMISSIONS).toContain(permission);
      }
    });

    it('grants nothing by way of the two lists that the names do not already grant', () => {
      // A list is a demand, never a grant. Both are satisfied by the manager
      // alone, which is the same thing the seven names say.
      for (const list of [
        SETTLEMENT_EXPORT_PERMISSIONS,
        SETTLEMENT_RATING_CORRECTION_PERMISSIONS,
      ]) {
        expect(list.every((permission) => permissionsForRole('MANAGER').includes(permission))).toBe(
          true,
        );
        expect(
          list.some((permission) => permissionsForRole('RECEPTIONIST').includes(permission)),
        ).toBe(false);
      }
    });
  });

  describe('the public website', () => {
    // Milestone 9, checkpoint A1. The permission model is frozen before any
    // publishing behaviour exists, for the reason the settlement model was: the
    // surfaces built in the later checkpoints must not each decide what
    // authority they need.
    const WEBSITE_PERMISSIONS = [
      'therapist.publish_profile',
      'clinic_profile.read',
      'clinic_profile.update',
    ] as const;

    /**
     * Milestone 9, checkpoint A2. The content vocabulary, added with the acts
     * that make it real — not before them, which is the rule A1 stated when it
     * deliberately left drafting unnameable.
     */
    const CONTENT_DRAFT_PERMISSIONS = [
      'article.read',
      'article.draft',
      'testimonial.read',
      'testimonial.draft',
    ] as const;

    const CONTENT_PUBLISH_PERMISSIONS = ['article.publish', 'testimonial.approve'] as const;

    it('defines exactly the three approved names', () => {
      for (const permission of WEBSITE_PERMISSIONS) {
        expect(PERMISSIONS).toContain(permission);
      }

      expect(
        PERMISSIONS.filter((permission) => permission.startsWith('clinic_profile.')).sort(),
      ).toEqual(['clinic_profile.read', 'clinic_profile.update'].sort());
    });

    it('names nothing this checkpoint did not approve', () => {
      for (const absent of [
        // A2 named the six content permissions that describe acts it actually
        // built. These are the ones it did NOT: a catch-all over all public
        // content, and a create name where `article.draft` is the act.
        'article.create',
        'content.publish',
        'content.draft',
        'website.manage',
        // A4 named the two inbox authorities that describe acts it built. These
        // are the ones it did NOT: a conversion name would be a second authority
        // to create a family, reachable from a screen where the duplicate check
        // could be skipped, and there is no separate authority for the retention
        // run because no signed-in user performs it.
        'website_request.convert',
        'website_request.purge',
        'website_request.delete',
        // The public reads carry no permission at all — they are classified
        // `internal` and hold none.
        'public.read',
      ] as const) {
        expect(PERMISSIONS).not.toContain(absent as never);
      }
    });

    it('names drafting and publishing as different permissions', () => {
      // THE FROZEN A1 RULE, PINNED. "Draft authority does not imply publish
      // authority, so the permission that publishes will never be the
      // permission that writes." Six names, and no name appears in both lists.
      for (const permission of [...CONTENT_DRAFT_PERMISSIONS, ...CONTENT_PUBLISH_PERMISSIONS]) {
        expect(PERMISSIONS).toContain(permission);
      }

      for (const drafting of CONTENT_DRAFT_PERMISSIONS) {
        expect(CONTENT_PUBLISH_PERMISSIONS).not.toContain(drafting as never);
      }
    });

    it('gives the receptionist every draft name and no publication name', () => {
      // BOTH HALVES, because either alone would be a lie. A receptionist may
      // write every word of an article and may make none of it visible.
      const receptionist = permissionsForRole('RECEPTIONIST');
      const manager = permissionsForRole('MANAGER');

      for (const permission of CONTENT_DRAFT_PERMISSIONS) {
        expect(receptionist).toContain(permission);
        expect(manager).toContain(permission);
      }

      for (const permission of CONTENT_PUBLISH_PERMISSIONS) {
        expect(receptionist).not.toContain(permission);
        expect(manager).toContain(permission);
      }
    });

    it('names one authority over a testimonial public life, not four', () => {
      // Approving, withdrawing approval, publishing and unpublishing are four
      // acts and one authority: nothing in the product ever grants one without
      // the others, and no route demands a pair of them at once — which is what
      // made the settlement rate/void split load-bearing and makes this one
      // unnecessary.
      for (const absent of [
        'testimonial.publish',
        'testimonial.unpublish',
        'testimonial.revoke_approval',
      ] as const) {
        expect(PERMISSIONS).not.toContain(absent as never);
      }
    });

    it('gives every one of them to the manager and none of them to the receptionist', () => {
      // Draft authority does not imply publish authority, and this role holds
      // neither today. Publishing a colleague photograph and biography, and
      // setting the address and telephone number a public site prints, are
      // manager decisions.
      const manager = permissionsForRole('MANAGER');
      const receptionist = permissionsForRole('RECEPTIONIST');

      for (const permission of WEBSITE_PERMISSIONS) {
        expect(manager).toContain(permission);
        expect(receptionist).not.toContain(permission);
      }
    });

    it('keeps publishing a therapist separate from editing one', () => {
      // The opt-in model in one assertion: `therapist.update` maintains the
      // personnel row, `therapist.publish_profile` decides whether a named
      // human being appears on a public website. One name covering both would
      // mean anybody who may fix a misspelt specialty may publish a colleague.
      expect(PERMISSIONS).toContain('therapist.update');
      expect(PERMISSIONS).toContain('therapist.publish_profile');
      expect(permissionsForRole('RECEPTIONIST')).not.toContain('therapist.update');
      expect(permissionsForRole('RECEPTIONIST')).not.toContain('therapist.publish_profile');
    });

    it('adds no second name for publishing a service', () => {
      // A service public description, its slug and its visibility are columns
      // on the catalog row, written under `service.update`, which has been
      // manager-only since Milestone 2.
      for (const absent of ['service.publish', 'service.update_public_profile'] as const) {
        expect(PERMISSIONS).not.toContain(absent as never);
      }
    });
  });

  it('names only permissions that exist in the contract', () => {
    for (const granted of Object.values(ROLE_PERMISSIONS)) {
      for (const permission of granted) {
        expect(PERMISSIONS).toContain(permission);
      }
    }
  });
});
