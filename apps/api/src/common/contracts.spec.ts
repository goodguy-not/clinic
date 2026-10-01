import {
  APPOINTMENT_STATUSES,
  ATTENDANCE_OUTCOMES,
  AVAILABILITY_WINDOWS_MAX,
  ERROR_CODES,
  NOTICE_CODES,
  PERMISSIONS,
  RECURRENCE_BLOCK_CODES,
  RECURRENCE_ENDS,
  RECURRENCE_HORIZON_MONTHS,
  RECURRENCE_OCCURRENCES_MAX,
  USER_ROLES,
  USER_STATUSES,
  appointmentDayQuerySchema,
  appointmentDetailSchema,
  appointmentParticipantSchema,
  appointmentSchema,
  appointmentSeriesDetailSchema,
  appointmentSeriesSchema,
  appointmentTariffSuggestionSchema,
  availabilityWindowInputSchema,
  cancelAppointmentRequestSchema,
  completeAppointmentRequestSchema,
  clockTimeSchema,
  createAppointmentRequestSchema,
  createAppointmentSeriesRequestSchema,
  createAvailabilityExceptionRequestSchema,
  createChildRequestSchema,
  createFamilyRequestSchema,
  errorEnvelopeSchema,
  updateFamilyStatusRequestSchema,
  iranLandlineSchema,
  iranMobileSchema,
  loginResponseSchema,
  loginRequestSchema,
  moveAppointmentRequestSchema,
  nationalIdSchema,
  recordAttendanceRequestSchema,
  reopenAppointmentRequestSchema,
  replaceAvailabilityWindowsRequestSchema,
  resolvedAvailabilitySchema,
  updateAppointmentSeriesFromRequestSchema,
  usernameSchema,
  weekdaySchema,
} from '@clinic/contracts';

/**
 * Proves `@clinic/contracts` is consumable from the CommonJS side.
 *
 * NestJS compiles to CommonJS and Next.js is ESM/bundler, so the package is
 * built once to CommonJS and consumed by both. A parallel test in `apps/web`
 * covers the other side; together they are the regression guard for the
 * packaging decision, which is otherwise only exercised at runtime.
 */
describe('@clinic/contracts (CommonJS consumption)', () => {
  it('exports the Milestone 1 constants', () => {
    expect(USER_ROLES).toEqual(['MANAGER', 'RECEPTIONIST']);
    expect(USER_STATUSES).toEqual(['ACTIVE', 'DISABLED']);
    expect(PERMISSIONS).toContain('user.create');
    expect(ERROR_CODES).toContain('AUTH_INVALID_CREDENTIALS');
  });

  it('declares no therapist role, which is a later approved decision', () => {
    expect(USER_ROLES).not.toContain('THERAPIST');
  });

  it('has no duplicate error code or permission', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  describe('username', () => {
    it.each(['reza', 'a.b_c-d', 'x'.repeat(32)])('accepts %s', (value: string) => {
      expect(usernameSchema.safeParse(value).success).toBe(true);
    });

    it.each(['ab', 'x'.repeat(33), 'Reza', 'has space', 'unicodeیی'])(
      'rejects %s',
      (value: string) => {
        expect(usernameSchema.safeParse(value).success).toBe(false);
      },
    );
  });

  describe('strict response schemas', () => {
    const validLogin = {
      sessionToken: 'opaque-token',
      session: { cookieMaxAgeSeconds: 43200 },
      user: {
        id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        username: 'reza',
        displayName: 'Synthetic Manager',
        role: 'MANAGER',
        mustChangePassword: false,
        permissions: ['user.read'],
      },
    };

    it('parses a well-formed login response', () => {
      expect(loginResponseSchema.safeParse(validLogin).success).toBe(true);
    });

    it('REJECTS an unexpected field, which is how a leaked passwordHash fails a test', () => {
      const leaked = {
        ...validLogin,
        user: { ...validLogin.user, passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$x$y' },
      };

      expect(loginResponseSchema.safeParse(leaked).success).toBe(false);
    });

    it('rejects a non-positive cookie lifetime', () => {
      expect(
        loginResponseSchema.safeParse({ ...validLogin, session: { cookieMaxAgeSeconds: 0 } })
          .success,
      ).toBe(false);
    });

    it('rejects an unknown permission', () => {
      expect(
        loginResponseSchema.safeParse({
          ...validLogin,
          user: { ...validLogin.user, permissions: ['ledger.void'] },
        }).success,
      ).toBe(false);
    });
  });

  describe('request schemas', () => {
    it('accepts a well-formed login request', () => {
      expect(loginRequestSchema.safeParse({ username: 'reza', password: 'x' }).success).toBe(true);
    });

    it('rejects an unexpected field', () => {
      expect(
        loginRequestSchema.safeParse({ username: 'reza', password: 'x', role: 'MANAGER' }).success,
      ).toBe(false);
    });

    it('states no password policy, because the server is authoritative', () => {
      // A 1-character password parses here and is rejected by the API. Any
      // length rule in this package would be a second copy of a security rule
      // that the browser tier consumes, and the copies would drift.
      expect(loginRequestSchema.safeParse({ username: 'reza', password: 'a' }).success).toBe(true);
    });
  });

  describe('error envelope', () => {
    it('requires a request id, so every failure is traceable', () => {
      const withoutRequestId = { error: { code: 'INTERNAL_ERROR', message: 'boom' } };
      expect(errorEnvelopeSchema.safeParse(withoutRequestId).success).toBe(false);
    });

    it('parses a complete envelope', () => {
      const envelope = {
        error: {
          code: 'AUTH_INVALID_CREDENTIALS',
          message: 'Invalid credentials',
          requestId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        },
      };

      expect(errorEnvelopeSchema.safeParse(envelope).success).toBe(true);
    });

    it('rejects an unknown error code', () => {
      const envelope = {
        error: {
          code: 'SOMETHING_NEW',
          message: 'x',
          requestId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        },
      };

      expect(errorEnvelopeSchema.safeParse(envelope).success).toBe(false);
    });
  });
});

describe('Milestone 3 contracts', () => {
  it('adds exactly eight family and child permissions', () => {
    const m3 = PERMISSIONS.filter((permission) => /^(?:family|child)\./.test(permission));

    expect([...m3].sort()).toEqual([
      'child.create',
      'child.read',
      'child.update',
      'child.update_status',
      'family.create',
      'family.read',
      'family.update',
      'family.update_status',
    ]);
  });

  it('declares the family and child error codes', () => {
    for (const code of [
      'FAMILY_NOT_FOUND',
      'CHILD_NOT_FOUND',
      'FAMILY_POSSIBLE_DUPLICATE',
      'CHILD_POSSIBLE_DUPLICATE',
      'CHILD_NATIONAL_ID_TAKEN',
      'CHILD_LEGACY_FILE_NUMBER_TAKEN',
      'FAMILY_PRIMARY_GUARDIAN_INVALID',
      'FAMILY_INACTIVE',
      'CHILD_BIRTH_DATE_IN_FUTURE',
      'DRAFT_NOT_FOUND',
    ]) {
      expect(ERROR_CODES).toContain(code);
    }
  });

  it('has no duplicate notice code, and none that names a person', () => {
    expect(new Set(NOTICE_CODES).size).toBe(NOTICE_CODES.length);

    // A notice travels in a query string. A closed vocabulary of categories is
    // what keeps a candidate's name out of a URL.
    for (const code of NOTICE_CODES) expect(code).toMatch(/^[A-Z_]+$/);
  });

  describe('national identifier', () => {
    it.each(['1234567891', '0499370899', '0084575948'])('accepts %s', (value: string) => {
      expect(nationalIdSchema.safeParse(value).success).toBe(true);
    });

    it.each([
      ['123456789', 'nine digits'],
      ['12345678912', 'eleven digits'],
      ['1234567890', 'wrong check digit'],
      ['۱۲۳۴۵۶۷۸۹۱', 'Persian digits, which the web tier folds before validating'],
    ])('rejects %s (%s)', (value: string) => {
      expect(nationalIdSchema.safeParse(value).success).toBe(false);
    });

    it.each(['0000000000', '1111111111', '9999999999'])(
      'rejects the repdigit %s even though the arithmetic works',
      (value: string) => {
        // Exactly the value somebody types to get past a required field.
        expect(nationalIdSchema.safeParse(value).success).toBe(false);
      },
    );
  });

  describe('phone numbers are canonical national form', () => {
    it.each(['09121234567', '09001234567'])('accepts the mobile %s', (value: string) => {
      expect(iranMobileSchema.safeParse(value).success).toBe(true);
    });

    it.each(['+989121234567', '9121234567', '0912 123 4567', '۰۹۱۲۱۲۳۴۵۶۷', '091212345678'])(
      'rejects %s, which the web tier normalises first',
      (value: string) => {
        expect(iranMobileSchema.safeParse(value).success).toBe(false);
      },
    );

    it.each(['02112345678', '0341234567'])('accepts the landline %s', (value: string) => {
      expect(iranLandlineSchema.safeParse(value).success).toBe(true);
    });

    it.each(['0021234567', '02112345', '2112345678'])(
      'rejects the landline %s',
      (value: string) => {
        expect(iranLandlineSchema.safeParse(value).success).toBe(false);
      },
    );
  });

  describe('a family needs exactly one reachable primary contact', () => {
    const guardian = (overrides: Record<string, unknown> = {}) => ({
      fullName: 'سرپرست آزمایشی',
      relationship: 'MOTHER',
      relationshipNote: null,
      mobile: '09121234567',
      landline: null,
      isPrimaryContact: true,
      ...overrides,
    });

    const family = (guardians: unknown[]) => ({
      familyName: 'خانوادهٔ آزمایشی',
      address: null,
      note: null,
      guardians,
    });

    it('accepts one primary with a mobile', () => {
      expect(createFamilyRequestSchema.safeParse(family([guardian()])).success).toBe(true);
    });

    it('accepts a primary reachable only on a landline', () => {
      // A family reachable only on a landline is a real family, and refusing it
      // would refuse a patient.
      expect(
        createFamilyRequestSchema.safeParse(
          family([guardian({ mobile: null, landline: '02112345678' })]),
        ).success,
      ).toBe(true);
    });

    it('rejects a primary with no contact method at all', () => {
      expect(
        createFamilyRequestSchema.safeParse(family([guardian({ mobile: null, landline: null })]))
          .success,
      ).toBe(false);
    });

    it('rejects zero primaries and two primaries alike', () => {
      expect(
        createFamilyRequestSchema.safeParse(family([guardian({ isPrimaryContact: false })]))
          .success,
      ).toBe(false);

      expect(
        createFamilyRequestSchema.safeParse(
          family([guardian(), guardian({ fullName: 'سرپرست دوم' })]),
        ).success,
      ).toBe(false);
    });

    it('rejects a family with no guardian', () => {
      expect(createFamilyRequestSchema.safeParse(family([])).success).toBe(false);
    });

    it('requires a note for OTHER and forbids one otherwise', () => {
      expect(
        createFamilyRequestSchema.safeParse(
          family([guardian({ relationship: 'OTHER', relationshipNote: null })]),
        ).success,
      ).toBe(false);

      expect(
        createFamilyRequestSchema.safeParse(
          family([guardian({ relationship: 'OTHER', relationshipNote: 'همسایه' })]),
        ).success,
      ).toBe(true);

      expect(
        createFamilyRequestSchema.safeParse(
          family([guardian({ relationship: 'MOTHER', relationshipNote: 'اضافی' })]),
        ).success,
      ).toBe(false);
    });
  });

  it('never accepts a file number in a child request', () => {
    // It is generated by the server from a sequence. A field for it would be a
    // duplicate-key error waiting to happen on the busiest form in the clinic.
    const child = {
      firstName: 'کودک',
      lastName: 'آزمایشی',
      birthDate: '2020-03-21',
      sex: 'UNSPECIFIED',
      nationalId: null,
      legacyPaperFileNumber: null,
      referralSource: null,
      note: null,
    };

    expect(createChildRequestSchema.safeParse(child).success).toBe(true);
    expect(createChildRequestSchema.safeParse({ ...child, fileNumber: '10001' }).success).toBe(
      false,
    );
  });
});

describe('Milestone 4 contracts', () => {
  it('declares the appointment, recurrence and availability error codes', () => {
    for (const code of [
      'APPOINTMENT_NOT_FOUND',
      'APPOINTMENT_SERIES_NOT_FOUND',
      'APPOINTMENT_PARTICIPANT_NOT_FOUND',
      'APPOINTMENT_THERAPIST_CONFLICT',
      'APPOINTMENT_ROOM_CONFLICT',
      'APPOINTMENT_CHILD_CONFLICT',
      'APPOINTMENT_TIME_INVALID',
      'APPOINTMENT_DURATION_NOT_ALLOWED',
      'APPOINTMENT_TRANSITION_INVALID',
      'APPOINTMENT_OUTSIDE_AVAILABILITY',
      'RECURRENCE_RULE_INVALID',
      'AVAILABILITY_WINDOW_INVALID',
      'ROOM_INACTIVE',
      'CHILD_INACTIVE',
    ]) {
      expect(ERROR_CODES).toContain(code);
    }
  });

  it('names each conflicting resource separately', () => {
    // One `APPOINTMENT_CONFLICT` would leave the receptionist guessing which of
    // the therapist, the room or the child is busy, and therefore which field
    // to change.
    expect(ERROR_CODES).not.toContain('APPOINTMENT_CONFLICT');
  });

  it('adds the appointment and availability permission names only', () => {
    const m4 = PERMISSIONS.filter((permission) =>
      /^(?:appointment|availability)\./.test(permission),
    );

    expect([...m4].sort()).toEqual([
      'appointment.cancel',
      'appointment.complete',
      'appointment.create',
      'appointment.override_availability',
      'appointment.read',
      'appointment.reopen',
      'appointment.update',
      'availability.manage',
      'availability.read',
    ]);
  });

  it('carries no financial field on an appointment or a seat', () => {
    // Pricing a session is Milestone 5's. A tariff, a price, a discount or a
    // charge appearing on either shape would put an amount into the contract
    // before the rules that produce it are approved.
    const financial = /tariff|price|amount|toman|charge|discount|fee/i;

    for (const shape of [appointmentSchema, appointmentParticipantSchema]) {
      for (const field of Object.keys(shape.shape)) {
        expect(field).not.toMatch(financial);
      }
    }
  });

  it('keeps the booking lifecycle and the seat attendance as two separate facts', () => {
    // A seat carries no status, and a booking carries no attendance. Neither is
    // derived from the other: a child may be absent from a session that took
    // place.
    expect(Object.keys(appointmentParticipantSchema.shape)).toContain('attendance');
    expect(Object.keys(appointmentParticipantSchema.shape)).not.toContain('status');
    expect(Object.keys(appointmentSchema.shape)).toContain('status');
    expect(Object.keys(appointmentSchema.shape)).not.toContain('attendance');
  });

  it('does not carry the family on a seat, which the child already decides', () => {
    expect(Object.keys(appointmentParticipantSchema.shape)).not.toContain('familyId');
  });

  it('gives the booking four lifecycle values and no more', () => {
    expect([...APPOINTMENT_STATUSES]).toEqual([
      'SCHEDULED',
      'COMPLETED',
      'CANCELLED_BY_FAMILY',
      'CANCELLED_BY_CLINIC',
    ]);

    // A no-show is a seat's outcome, not a state of the booking: the room was
    // held and the therapist waited. Voiding is not part of this lifecycle
    // either — reversing a recorded financial fact belongs to Milestone 5.
    expect(APPOINTMENT_STATUSES).not.toContain('NO_SHOW');
    expect(APPOINTMENT_STATUSES).not.toContain('VOIDED');
    expect(APPOINTMENT_STATUSES).not.toContain('RESCHEDULED');
  });

  it('puts the no-show on the seat, and declares no ABSENT', () => {
    expect([...ATTENDANCE_OUTCOMES]).toEqual(['PENDING', 'ATTENDED', 'NO_SHOW']);
    expect(ATTENDANCE_OUTCOMES).not.toContain('ABSENT');
  });

  it('numbers weekdays from Saturday, which is the shared product contract', () => {
    // 0 is Saturday through 6 is Friday — the Iranian week — and deliberately
    // not PostgreSQL's EXTRACT(DOW), which starts on Sunday. Other consumers of
    // this package depend on this numbering, so it is pinned here as well as at
    // the database boundary.
    for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
      expect(weekdaySchema.safeParse(weekday).success).toBe(true);
    }

    expect(weekdaySchema.safeParse(7).success).toBe(false);
    expect(weekdaySchema.safeParse(-1).success).toBe(false);
    expect(weekdaySchema.safeParse(1.5).success).toBe(false);
  });

  it('bounds a series by an occurrence count or an end date, never both', () => {
    expect([...RECURRENCE_ENDS]).toEqual(['OCCURRENCE_COUNT', 'END_DATE']);
  });

  describe('the availability contract', () => {
    const windowInput = (overrides: Record<string, unknown> = {}) => ({
      weekday: 0,
      startTime: '09:00',
      endTime: '13:00',
      ...overrides,
    });

    it('declares the availability management error codes', () => {
      for (const code of [
        'AVAILABILITY_WINDOW_OVERLAP',
        'AVAILABILITY_EXCEPTION_CONFLICT',
        'AVAILABILITY_EXCEPTION_NOT_FOUND',
      ]) {
        expect(ERROR_CODES).toContain(code);
      }
    });

    it('accepts a well-formed recurring window', () => {
      expect(availabilityWindowInputSchema.safeParse(windowInput()).success).toBe(true);
    });

    it('rejects a window that ends before or when it starts', () => {
      expect(
        availabilityWindowInputSchema.safeParse(windowInput({ endTime: '08:00' })).success,
      ).toBe(false);
      expect(
        availabilityWindowInputSchema.safeParse(windowInput({ endTime: '09:00' })).success,
      ).toBe(false);
    });

    it('is a weekday and two times, with no effective dating of any kind', () => {
      // Recurring availability is current configuration. A start or end date on
      // a window would be effective-dated availability history, which is not
      // approved and must not be expressible.
      expect(Object.keys(availabilityWindowInputSchema.def.shape).sort()).toEqual([
        'endTime',
        'startTime',
        'weekday',
      ]);

      for (const dated of ['effectiveFrom', 'effectiveTo', 'validFrom', 'validTo', 'startsOn']) {
        expect(
          availabilityWindowInputSchema.safeParse(windowInput({ [dated]: '2026-01-01' })).success,
        ).toBe(false);
      }
    });

    it('carries no id, because the set is replaced rather than edited row by row', () => {
      expect(
        availabilityWindowInputSchema.safeParse({
          ...windowInput(),
          id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        }).success,
      ).toBe(false);
    });

    it('accepts an empty week, which clears a therapist’s standing hours', () => {
      expect(replaceAvailabilityWindowsRequestSchema.safeParse({ windows: [] }).success).toBe(true);
    });

    it('refuses a submission beyond the weekly ceiling', () => {
      const tooMany = Array.from({ length: AVAILABILITY_WINDOWS_MAX + 1 }, () => windowInput());

      expect(replaceAvailabilityWindowsRequestSchema.safeParse({ windows: tooMany }).success).toBe(
        false,
      );
    });

    it('pairs a dated exception with exactly what its kind requires', () => {
      const closed = { isAvailable: false, exceptionDate: '2026-09-01', reason: 'مرخصی' };
      const open = {
        isAvailable: true,
        exceptionDate: '2026-09-01',
        startTime: '16:00',
        endTime: '19:00',
        reason: null,
      };

      expect(createAvailabilityExceptionRequestSchema.safeParse(closed).success).toBe(true);
      expect(createAvailabilityExceptionRequestSchema.safeParse(open).success).toBe(true);

      // A closed day with times, and an extra window without them, are both
      // half-stated facts that the database CHECK refuses as well.
      expect(
        createAvailabilityExceptionRequestSchema.safeParse({
          ...closed,
          startTime: '16:00',
          endTime: '19:00',
        }).success,
      ).toBe(false);

      expect(
        createAvailabilityExceptionRequestSchema.safeParse({
          isAvailable: true,
          exceptionDate: '2026-09-01',
          reason: null,
        }).success,
      ).toBe(false);
    });

    it('resolves a date to Saturday-first windows and never to stored rows', () => {
      const resolved = {
        therapistId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        date: '2026-09-01',
        weekday: 3,
        isClosed: false,
        closedReason: null,
        windows: [{ startTime: '09:00', endTime: '13:00' }],
      };

      expect(resolvedAvailabilitySchema.safeParse(resolved).success).toBe(true);

      // The resolved answer carries no row identity: a caller must not be able
      // to tell a recurring window from a dated one, because they are equally
      // available time.
      expect(
        resolvedAvailabilitySchema.safeParse({
          ...resolved,
          windows: [{ startTime: '09:00', endTime: '13:00', source: 'recurring' }],
        }).success,
      ).toBe(false);
    });
  });

  describe('the booking contract', () => {
    const booking = (overrides: Record<string, unknown> = {}) => ({
      serviceId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      durationMinutes: 45,
      therapistId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
      roomId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d',
      childId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5e',
      startsAt: '2026-09-05T06:30:00.000Z',
      note: null,
      availabilityOverrideReason: null,
      ...overrides,
    });

    it('accepts a well-formed booking', () => {
      expect(createAppointmentRequestSchema.safeParse(booking()).success).toBe(true);
    });

    it('books exactly one child, never a list', () => {
      // An individual appointment has exactly one participant. A group booking
      // is a different shape with rules none of which are approved, and an array
      // here would be a guess at all of them.
      expect(
        createAppointmentRequestSchema.safeParse({
          ...booking(),
          childId: undefined,
          childIds: ['0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5e'],
        }).success,
      ).toBe(false);
    });

    it('accepts no end, no status, no series and no price', () => {
      // `endsAt` is `startsAt + durationMinutes` and the database says so; a
      // status would let a create request reach a state a transition guards; a
      // series would attach an occurrence to a pattern it does not match; and a
      // price is Milestone 5's.
      for (const extra of [
        { endsAt: '2026-09-05T07:15:00.000Z' },
        { status: 'COMPLETED' },
        { seriesId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5f' },
        { priceToman: '250000' },
      ]) {
        expect(createAppointmentRequestSchema.safeParse({ ...booking(), ...extra }).success).toBe(
          false,
        );
      }
    });

    it('requires a non-empty reason when an override is claimed', () => {
      // Null is "apply the rule". A blank string would be an override with no
      // explanation, which is the flag this design rejects.
      expect(
        createAppointmentRequestSchema.safeParse(booking({ availabilityOverrideReason: '   ' }))
          .success,
      ).toBe(false);

      expect(
        createAppointmentRequestSchema.safeParse(
          booking({ availabilityOverrideReason: 'جلسهٔ جبرانی با هماهنگی درمانگر' }),
        ).success,
      ).toBe(true);
    });

    it('offers no override for a therapist, room or child conflict', () => {
      const fields = Object.keys(createAppointmentRequestSchema.shape);

      expect(fields.filter((field) => /override/i.test(field))).toEqual([
        'availabilityOverrideReason',
      ]);
    });

    it('carries no financial field', () => {
      const financial = /tariff|price|amount|toman|charge|discount|fee/i;

      for (const field of Object.keys(createAppointmentRequestSchema.shape)) {
        expect(field).not.toMatch(financial);
      }
    });
  });

  describe('the lifecycle contract', () => {
    const placement = (overrides: Record<string, unknown> = {}) => ({
      durationMinutes: 45,
      therapistId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
      roomId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d',
      startsAt: '2026-09-05T06:30:00.000Z',
      note: null,
      availabilityOverrideReason: null,
      ...overrides,
    });

    it('accepts a complete new placement', () => {
      expect(moveAppointmentRequestSchema.safeParse(placement()).success).toBe(true);
    });

    it('refuses to move the service, the child or the status', () => {
      // Changing what was booked, or who it was booked for, is a different
      // booking rather than a move — and a status is reached through a
      // transition that guards it, never through an edit.
      for (const extra of [
        { serviceId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' },
        { childId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5e' },
        { status: 'COMPLETED' },
        { endsAt: '2026-09-05T07:15:00.000Z' },
      ]) {
        expect(moveAppointmentRequestSchema.safeParse(placement(extra)).success).toBe(false);
      }
    });

    it('names the cancelling party rather than a status', () => {
      expect(
        cancelAppointmentRequestSchema.safeParse({ cancelledBy: 'FAMILY', reason: 'بیماری' })
          .success,
      ).toBe(true);

      // The status is derived from the party, so the two dashboard counts
      // cannot be filled from a free choice of status name.
      expect(
        cancelAppointmentRequestSchema.safeParse({
          cancelledBy: 'CANCELLED_BY_FAMILY',
          reason: 'بیماری',
        }).success,
      ).toBe(false);
    });

    it('always requires a cancellation reason', () => {
      for (const body of [
        { cancelledBy: 'CLINIC' },
        { cancelledBy: 'CLINIC', reason: '' },
        { cancelledBy: 'CLINIC', reason: '   ' },
      ]) {
        expect(cancelAppointmentRequestSchema.safeParse(body).success).toBe(false);
      }
    });

    it('lets a completion carry nothing at all', () => {
      expect(completeAppointmentRequestSchema.safeParse({}).success).toBe(true);

      // Not a place a price, a status or an attendance can be smuggled in.
      for (const extra of [
        { priceToman: '250000' },
        { status: 'COMPLETED' },
        { attendance: 'ATTENDED' },
      ]) {
        expect(completeAppointmentRequestSchema.safeParse(extra).success).toBe(false);
      }
    });

    it('requires a reason to reopen a completion', () => {
      expect(reopenAppointmentRequestSchema.safeParse({ reason: 'اصلاح' }).success).toBe(true);
      expect(reopenAppointmentRequestSchema.safeParse({}).success).toBe(false);
      expect(reopenAppointmentRequestSchema.safeParse({ reason: '  ' }).success).toBe(false);
    });

    it('records an outcome, and never un-records one', () => {
      for (const attendance of ['ATTENDED', 'NO_SHOW']) {
        expect(recordAttendanceRequestSchema.safeParse({ attendance }).success).toBe(true);
      }

      // `PENDING` is the state of an outcome nobody has entered. Setting it
      // back would erase a fact a person recorded rather than correct it.
      expect(recordAttendanceRequestSchema.safeParse({ attendance: 'PENDING' }).success).toBe(
        false,
      );
    });

    it('carries no financial field on any lifecycle request', () => {
      const financial = /tariff|price|amount|toman|charge|discount|fee/i;

      for (const schema of [
        moveAppointmentRequestSchema,
        cancelAppointmentRequestSchema,
        reopenAppointmentRequestSchema,
        recordAttendanceRequestSchema,
      ]) {
        for (const field of Object.keys(schema.shape)) {
          expect(field).not.toMatch(financial);
        }
      }
    });
  });

  describe('the day read model', () => {
    it('asks for one clinic day, by ids and never by name', () => {
      expect(appointmentDayQuerySchema.safeParse({ date: '2026-09-05' }).success).toBe(true);

      // A family or child name in a query string reaches the browser history,
      // the Referer header and every access log — the reason family search is a
      // POST that reads.
      expect(
        appointmentDayQuerySchema.safeParse({ date: '2026-09-05', childName: 'کودک' }).success,
      ).toBe(false);

      // One day, never a range: a filter that could span a month is a report.
      expect(
        appointmentDayQuerySchema.safeParse({ date: '2026-09-05', toDate: '2026-09-12' }).success,
      ).toBe(false);
    });

    it('states a missing tariff as a value, not as an absent field', () => {
      // "Missing tariff is a visible error" (PROJECT_SPEC.md 5), and a day view
      // that failed because one service has no price would take the whole diary
      // down with it.
      expect(appointmentTariffSuggestionSchema.safeParse({ status: 'MISSING' }).success).toBe(true);

      expect(
        appointmentTariffSuggestionSchema.safeParse({
          status: 'RESOLVED',
          tariffId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
          priceMode: 'PAID',
          priceToman: '250000',
        }).success,
      ).toBe(true);

      // A resolved suggestion always names the tariff it came from, so a reader
      // can see which price list row produced it.
      expect(
        appointmentTariffSuggestionSchema.safeParse({ status: 'RESOLVED', priceToman: '250000' })
          .success,
      ).toBe(false);
    });

    it('keeps the price out of the shape a write returns', () => {
      // `appointmentDetailSchema` is what booking, moving, completing and
      // cancelling return. A price travelling out of a transaction that books a
      // session is one step from being stored in it.
      expect(Object.keys(appointmentDetailSchema.shape)).toEqual(['appointment', 'participants']);
    });
  });

  describe('the recurrence contract', () => {
    const rule = { endMode: 'OCCURRENCE_COUNT', intervalWeeks: 1, occurrenceCount: 12 };
    const series = (overrides: Record<string, unknown> = {}) => ({
      serviceId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      durationMinutes: 45,
      therapistId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
      roomId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d',
      childId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5e',
      startsAt: '2026-09-05T06:30:00.000Z',
      note: null,
      availabilityOverrideReason: null,
      recurrence: rule,
      ...overrides,
    });

    it('accepts a series stated as a first booking plus a rule', () => {
      expect(createAppointmentSeriesRequestSchema.safeParse(series()).success).toBe(true);
    });

    it('cannot state two bounds, or none', () => {
      // The discriminated union makes `appointment_series_end_chk` unreachable
      // from a well-formed request rather than merely agreed with.
      expect(
        createAppointmentSeriesRequestSchema.safeParse(
          series({ recurrence: { ...rule, endsOn: '2026-12-05' } }),
        ).success,
      ).toBe(false);

      expect(
        createAppointmentSeriesRequestSchema.safeParse(
          series({ recurrence: { endMode: 'OCCURRENCE_COUNT', intervalWeeks: 1 } }),
        ).success,
      ).toBe(false);
    });

    it('states one weekday and one time, taken from the first occurrence', () => {
      // No `weekday`, no `weekdays`, no `startTime`: the pattern is read from
      // `startsAt`, and a second statement of it is a second thing that can
      // disagree. A twice-weekly child is two series, by design.
      const shape = Object.keys(createAppointmentSeriesRequestSchema.shape);

      expect(shape).toContain('startsAt');
      expect(shape).not.toContain('weekday');
      expect(shape).not.toContain('weekdays');
      expect(shape).not.toContain('startTime');
    });

    it('has no way to ask for a partial series', () => {
      // Creation is all or nothing. A flag that skipped conflicting weeks would
      // hand a family a term with silent holes in it.
      for (const field of ['skipConflicting', 'allowPartial', 'ignoreConflicts']) {
        expect(
          createAppointmentSeriesRequestSchema.safeParse(series({ [field]: true })).success,
        ).toBe(false);
      }
    });

    it('refuses a rule beyond the approved bounds', () => {
      for (const invalid of [
        { endMode: 'OCCURRENCE_COUNT', intervalWeeks: 1, occurrenceCount: 0 },
        { endMode: 'OCCURRENCE_COUNT', intervalWeeks: 0, occurrenceCount: 4 },
        { endMode: 'OCCURRENCE_COUNT', intervalWeeks: 13, occurrenceCount: 4 },
        { endMode: 'OCCURRENCE_COUNT', intervalWeeks: 1, occurrenceCount: 53 },
        { endMode: 'END_DATE', intervalWeeks: 1, endsOn: '2026-02-30' },
        { endMode: 'MONTHLY', intervalWeeks: 1, occurrenceCount: 4 },
      ]) {
        expect(
          createAppointmentSeriesRequestSchema.safeParse(series({ recurrence: invalid })).success,
        ).toBe(false);
      }
    });

    it('states the two approved bounds on one series as values', () => {
      // At most a year of weekly sessions, and no session more than a year
      // past the first. F4 consumers rely on both, so a change to either is a
      // change to what the clinic may book rather than an implementation
      // detail. `appointment_series_occurrence_count_chk` permits 260 and is
      // deliberately looser: it guards against a mistyped run of digits, not
      // against booking too far ahead.
      expect(RECURRENCE_OCCURRENCES_MAX).toBe(52);
      expect(RECURRENCE_HORIZON_MONTHS).toBe(12);
    });

    it('refuses a count past the approved bound in the request shape itself', () => {
      expect(
        createAppointmentSeriesRequestSchema.safeParse(
          series({
            recurrence: {
              endMode: 'OCCURRENCE_COUNT',
              intervalWeeks: 1,
              occurrenceCount: RECURRENCE_OCCURRENCES_MAX,
            },
          }),
        ).success,
      ).toBe(true);

      expect(
        createAppointmentSeriesRequestSchema.safeParse(
          series({
            recurrence: {
              endMode: 'OCCURRENCE_COUNT',
              intervalWeeks: 1,
              occurrenceCount: RECURRENCE_OCCURRENCES_MAX + 1,
            },
          }),
        ).success,
      ).toBe(false);
    });

    it('leaves the horizon to the service, which is the only tier that knows the first date', () => {
      // An end date twenty years out parses: whether it breaks either bound
      // depends on the first occurrence's clinic date, which is an instant this
      // shape never sees. The service answers `RECURRENCE_RULE_INVALID`.
      expect(
        createAppointmentSeriesRequestSchema.safeParse(
          series({ recurrence: { endMode: 'END_DATE', intervalWeeks: 1, endsOn: '2046-09-05' } }),
        ).success,
      ).toBe(true);
    });

    it('reports preview findings with the error codes the booking itself raises', () => {
      // Never a second vocabulary: the interface already translates these, and a
      // preview that invented its own names would say something different from
      // the refusal the same request produces a moment later.
      for (const code of RECURRENCE_BLOCK_CODES) expect(ERROR_CODES).toContain(code);
    });

    it('moves the hour of a series without moving its weekday', () => {
      const shape = Object.keys(updateAppointmentSeriesFromRequestSchema.shape);

      // A wall-clock time applied to each occurrence's own date. There is no
      // `startsAt`, no `weekday` and no recurrence rule: changing the rhythm is
      // a new series, and shortening one is `cancel-from`.
      expect(shape).toContain('startTime');
      expect(shape).not.toContain('startsAt');
      expect(shape).not.toContain('weekday');
      expect(shape).not.toContain('recurrence');
      // The service and the child are absent for the reason they are absent
      // from a single move: either would make it a different booking.
      expect(shape).not.toContain('serviceId');
      expect(shape).not.toContain('childId');
    });

    it('carries nothing financial on a series or its response', () => {
      const financial = /tariff|price|amount|toman|charge|discount|fee/i;

      for (const shape of [
        appointmentSeriesSchema,
        appointmentSeriesDetailSchema,
        createAppointmentSeriesRequestSchema,
      ]) {
        for (const field of Object.keys(shape.shape)) expect(field).not.toMatch(financial);
      }
    });
  });

  it('accepts a wall-clock availability time and rejects an instant', () => {
    expect(clockTimeSchema.safeParse('09:00').success).toBe(true);
    expect(clockTimeSchema.safeParse('23:59').success).toBe(true);
    expect(clockTimeSchema.safeParse('24:00').success).toBe(false);
    // Not an instant: a working window is a time of day, not a moment.
    expect(clockTimeSchema.safeParse('2026-09-01T09:00:00Z').success).toBe(false);
  });
});

describe('the family status request (Milestone 10, A6)', () => {
  const balance = { amountDueToman: '250000', creditToman: '0' };

  it('accepts a deactivation with or without an acknowledged balance', () => {
    expect(updateFamilyStatusRequestSchema.safeParse({ status: 'INACTIVE' }).success).toBe(true);
    expect(
      updateFamilyStatusRequestSchema.safeParse({
        status: 'INACTIVE',
        acknowledgedBalance: balance,
      }).success,
    ).toBe(true);
  });

  it('refuses an acknowledgement on an activation, where it would acknowledge nothing', () => {
    expect(updateFamilyStatusRequestSchema.safeParse({ status: 'ACTIVE' }).success).toBe(true);
    expect(
      updateFamilyStatusRequestSchema.safeParse({ status: 'ACTIVE', acknowledgedBalance: balance })
        .success,
    ).toBe(false);
  });

  it('takes the amounts as canonical toman strings and nothing else', () => {
    for (const acknowledgedBalance of [
      { amountDueToman: 250000, creditToman: '0' },
      { amountDueToman: '0250000', creditToman: '0' },
      { amountDueToman: '250000' },
      { ...balance, note: 'x' },
    ]) {
      expect(
        updateFamilyStatusRequestSchema.safeParse({ status: 'INACTIVE', acknowledgedBalance })
          .success,
      ).toBe(false);
    }
  });
});
