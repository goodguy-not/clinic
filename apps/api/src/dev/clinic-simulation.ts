import type { INestApplicationContext } from '@nestjs/common';
import {
  cancelAppointmentRequestSchema,
  cancelAppointmentSeriesFromRequestSchema,
  closeSettlementPeriodRequestSchema,
  correctSessionRatingRequestSchema,
  createAppointmentRequestSchema,
  createAppointmentSeriesRequestSchema,
  createChargeAdjustmentRequestSchema,
  createChildRequestSchema,
  createFamilyRequestSchema,
  createPaymentRequestSchema,
  createPromiseRequestSchema,
  createRoomRequestSchema,
  createServiceRequestSchema,
  createShareRuleRequestSchema,
  createTariffRequestSchema,
  createTherapistRequestSchema,
  createUserRequestSchema,
  familyAccountReportExportQuerySchema,
  moveAppointmentRequestSchema,
  paymentReportExportQuerySchema,
  publicRequestSubmissionSchema,
  PUBLIC_REQUEST_CONSENT_VERSIONS,
  rateSessionRequestSchema,
  recordAttendanceRequestSchema,
  replaceAvailabilityWindowsRequestSchema,
  websiteRequestInboxQuerySchema,
  type AppointmentDetail,
  type PaymentMethod,
  type SettlementPeriodLine,
  type UserRole,
} from '@clinic/contracts';
import { AppModule } from '../app.module';
import { AppointmentSeriesService } from '../appointments/appointment-series.service';
import { AppointmentsService } from '../appointments/appointments.service';
import {
  collectRoutes,
  verdict,
  visitorVerdict,
  type RouteEntry,
} from '../auth/route-access-matrix';
import { AvailabilityService } from '../availability/availability.service';
import { RoomsService } from '../catalog/rooms/rooms.service';
import { ServicesService } from '../catalog/services/services.service';
import { TariffsService } from '../catalog/tariffs/tariffs.service';
import { TherapistsService } from '../catalog/therapists/therapists.service';
import { AppError } from '../common/app-error';
import { uuidv7 } from '../common/uuid';
import type { ResolvedSession } from '../common/request-context';
import { ChildrenService } from '../families/children/children.service';
import { RegistrationDraftsService } from '../families/drafts/registration-drafts.service';
import { FamiliesService } from '../families/families/families.service';
import { ChargeAdjustmentsService } from '../ledger/charge-adjustments.service';
import { SessionChargesService } from '../ledger/session-charges.service';
import { PaymentsService } from '../payments/payments.service';
import { PromisesService } from '../payments/promises.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReportExportService } from '../reports/report-export.service';
import { SettlementCloseService } from '../settlement/close/settlement-close.service';
import { SessionRatingService } from '../settlement/ratings/session-rating.service';
import { ShareRulesService } from '../settlement/share-rules/share-rules.service';
import { UsersService } from '../users/users.service';
import { PublicRequestsService } from '../website/public-requests.service';
import { WebsiteRequestsService } from '../website/website-requests.service';
import { expectedSessionValue } from './clinic-reconciliation';
import {
  addDays,
  clinicToday,
  clinicWeekday,
  managerActor,
  requestContext,
  sessionFor,
  tehranInstant,
} from './synthetic-clinic';

/**
 * A SYNTHETIC CLINIC'S LAST TWO MONTHS, DRIVEN THROUGH THE STAFF SERVICES
 * (Milestone 10, checkpoint A5).
 *
 * EVERYTHING HERE IS INVENTED, AND OBVIOUSLY SO. Every person is "نمونه"
 * (sample) plus a tree's name, every mobile number starts `0900` — a prefix no
 * Iranian operator issues — no child carries a national identifier, and the
 * website enquiries arrive from TEST-NET addresses. Nothing can be supplied to
 * this file from outside it: there is no import path for a spreadsheet, so it
 * cannot become one.
 *
 * WHAT IT IS FOR. Proof that money stays correct under realistic use, and a
 * reusable practice clinic for the walkthrough, the operator guide and staff
 * training. It is never a content-management mechanism: it writes no article,
 * no testimonial and no clinic profile, and publishes exactly one service so the
 * contact form has something to name.
 *
 * HOW IT ACTS. Every act goes through the domain service the matching NestJS
 * route calls, with a request parsed by that route's contract schema, under the
 * person who would do it at the clinic — a receptionist at the front desk, the
 * manager for configuration, corrections and settlement, an anonymous visitor
 * for the contact form. Before each act, `act` looks the route up in the
 * route × role matrix (`auth/route-access-matrix.ts`) and refuses to continue
 * if that role could not call it over HTTP, so the simulation is also the
 * dual-role walkthrough the final review compares against. Never SQL: the only
 * statements this file issues are two reads (the emptiness precondition and the
 * clinic's own calendar day).
 *
 * WHAT IT REMEMBERS. Alongside every act it writes what the act SHOULD have
 * done into a `SimulationBook`, using its own price list and share rules, never
 * a value read back from the application. `clinic-reconciliation.ts` then
 * compares the book with what the application reports. The book is the
 * independent side of that comparison; reading an amount back to store it would
 * make the reconciliation a test that cannot fail.
 *
 * THE CALENDAR IS THE CLINIC'S, AND RELATIVE TO TODAY. History runs from three
 * weeks before the previous Jalali month to yesterday, so it always contains one
 * whole Jalali month (closed for settlement) and crosses at least one Jalali
 * month end; a week of future bookings is added so the diary has a tomorrow.
 * Business dates (session days, money received, promises due) are back-dated;
 * every recorded instant is the real one, exactly as a clinic catching up its
 * books would produce.
 *
 * IT REQUIRES AN EMPTY CLINIC with one active manager (`bootstrap-manager`),
 * and refuses otherwise: a practice clinic laid on top of another clinic would
 * make every reconciled total a sum of two worlds.
 */

// ---------------------------------------------------------------------------
// The book: what the simulation did and what it expects
// ---------------------------------------------------------------------------

export type SimRole = UserRole | 'VISITOR';

export type SimulationCalendar = {
  today: string;
  /** First history day. */
  windowStart: string;
  /** Yesterday: the last day whose sessions are processed. */
  lastHistoryDay: string;
  /** The last booked day (a week ahead). */
  bookedUntil: string;
  /** The previous Jalali month, which is closed for settlement. */
  closedMonth: { from: string; to: string; label: string };
  /** The Jalali months the history touches, each clipped to the history. */
  months: { from: string; to: string; label: string }[];
};

export type BookTariff = {
  serviceId: string;
  durationMinutes: number;
  therapistId: string | null;
  priceMode: 'PAID' | 'FREE';
  priceToman: bigint;
  from: string;
  to: string | null;
};

export type BookShareRule = {
  id: string;
  therapistId: string;
  basisPoints: number;
  from: string;
  to: string | null;
  voided: boolean;
};

export type BookSession = {
  appointmentId: string;
  participantId: string;
  seriesId: string | null;
  childId: string;
  familyId: string;
  therapistId: string;
  serviceId: string;
  roomId: string;
  date: string;
  startsAt: string;
  durationMinutes: number;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED_BY_FAMILY' | 'CANCELLED_BY_CLINIC';
  attendance: 'PENDING' | 'ATTENDED' | 'NO_SHOW';
  /** The valid charge the simulation saw raised for this seat, if any. */
  chargeId: string | null;
};

export type BookAdjustment = {
  id: string;
  amountToman: bigint;
  therapistPortionToman: bigint;
  voided: boolean;
};

export type BookCharge = {
  id: string;
  participantId: string;
  familyId: string;
  childId: string;
  therapistId: string;
  serviceId: string;
  serviceDate: string;
  durationMinutes: number;
  /** From the simulation's own price list at the service date. */
  expectedAmountToman: bigint;
  priceMode: 'PAID' | 'FREE';
  voided: boolean;
  adjustments: BookAdjustment[];
  /** The rating the simulation expects to be valid now, from its own share rules. */
  rating: { basisPoints: number; via: 'AUTOMATIC' | 'EXPLICIT' } | null;
};

export type BookPayment = {
  id: string;
  familyId: string;
  amountToman: bigint;
  method: PaymentMethod;
  receivedOn: string;
  recordedByUserId: string;
  voided: boolean;
};

export type BookPromise = {
  id: string;
  familyId: string;
  amountToman: bigint;
  dueOn: string;
  status: 'OPEN' | 'FULFILLED' | 'RESCHEDULED' | 'CANCELLED';
};

export type ExpectedSettlementLine = {
  sessionChargeId: string;
  serviceDate: string;
  basisPoints: number;
  baseAmountToman: bigint;
  therapistGrossToman: bigint;
  therapistDiscountToman: bigint;
  therapistNetToman: bigint;
  clinicGrossToman: bigint;
  clinicDiscountToman: bigint;
  clinicNetToman: bigint;
};

export type BookPeriod = {
  id: string;
  therapistId: string;
  from: string;
  to: string;
  /** What the application returned at the moment of the close. */
  linesAtClose: SettlementPeriodLine[];
  /** What the simulation expected the close to settle. */
  expectedLines: ExpectedSettlementLine[];
  expectedUnrated: number;
};

export type BookWebsiteRequest = {
  contactMobile: string;
  id: string | null;
  status: 'NEW' | 'CONTACTED' | 'FOLLOW_UP_NEEDED' | 'CONVERTED_TO_FAMILY' | 'CLOSED';
  linkedFamilyId: string | null;
};

export type SimulationStaffAccount = {
  username: string;
  displayName: string;
  role: UserRole;
  temporaryPassword: string | null;
};

export type SimulationBook = {
  calendar: SimulationCalendar;
  staff: SimulationStaffAccount[];
  userIds: { manager: string; receptionists: string[] };
  therapists: { id: string; label: string; sharesDiscounts: boolean }[];
  services: Record<'OT' | 'SP' | 'PL', string>;
  families: { id: string; label: string; childIds: string[] }[];
  tariffs: BookTariff[];
  shareRules: BookShareRule[];
  sessions: BookSession[];
  charges: Map<string, BookCharge>;
  payments: BookPayment[];
  promises: BookPromise[];
  periods: BookPeriod[];
  websiteRequests: BookWebsiteRequest[];
  /** Entity id → how many financial or audited acts the simulation performed on it. */
  audited: Map<string, number>;
  exports: {
    label: string;
    csv: string;
    rowCount: number;
    range: { from: string; to: string } | null;
  }[];
  /** Every act, counted by role and by route — the dual-role walkthrough in numbers. */
  acts: Record<SimRole, Record<string, number>>;
  /** Scenario coverage, counted as it happened. */
  scenario: Record<string, number>;
};

// ---------------------------------------------------------------------------
// Fixed shape of the synthetic clinic
// ---------------------------------------------------------------------------

const TREES = [
  'سرو',
  'کاج',
  'بید',
  'چنار',
  'نارون',
  'اقاقیا',
  'افرا',
  'بلوط',
  'زیتون',
  'انار',
  'توت',
  'گردو',
  'سپیدار',
  'شمشاد',
] as const;

const LETTERS = ['الف', 'ب'] as const;

/** Families with two children: balance is family-level, every charge names the child. */
const TWO_CHILD_FAMILIES = new Set([0, 3, 6, 9, 12]);

/** Index of the family registered from a website enquiry, not at the desk. */
const CONVERTED_FAMILY = 13;

const DAY_HOURS: readonly number[] = [9, 10, 11, 12, 14, 15, 16];
const AFTERNOON_HOURS: readonly number[] = [12, 13, 14, 15, 16, 17];

/** `0900` is not an issued Iranian mobile prefix; every number here is visibly fake. */
const mobile = (n: number) => `0900000${String(n).padStart(4, '0')}`;

const TEST_NET = (n: number) => `203.0.113.${n}`;

// ---------------------------------------------------------------------------
// The simulation
// ---------------------------------------------------------------------------

export type ClinicSimulation = { book: SimulationBook };

export async function simulateClinic(app: INestApplicationContext): Promise<ClinicSimulation> {
  const prisma = app.get(PrismaService);
  const svc = {
    users: app.get(UsersService),
    services: app.get(ServicesService),
    rooms: app.get(RoomsService),
    therapists: app.get(TherapistsService),
    tariffs: app.get(TariffsService),
    availability: app.get(AvailabilityService),
    families: app.get(FamiliesService),
    children: app.get(ChildrenService),
    drafts: app.get(RegistrationDraftsService),
    appointments: app.get(AppointmentsService),
    series: app.get(AppointmentSeriesService),
    charges: app.get(SessionChargesService),
    adjustments: app.get(ChargeAdjustmentsService),
    payments: app.get(PaymentsService),
    promises: app.get(PromisesService),
    shareRules: app.get(ShareRulesService),
    ratings: app.get(SessionRatingService),
    close: app.get(SettlementCloseService),
    exports: app.get(ReportExportService),
    publicRequests: app.get(PublicRequestsService),
    websiteRequests: app.get(WebsiteRequestsService),
  };

  await assertEmptyClinic(prisma);

  const today = await clinicToday(prisma);
  const calendar = buildCalendar(today);
  const { windowStart: ws } = calendar;
  const M1 = calendar.closedMonth.from;
  const M2 = addDays(calendar.closedMonth.to, 1);

  const manager: Person = {
    role: 'MANAGER',
    session: await managerActor(prisma),
    label: 'manager',
  };

  const book: SimulationBook = {
    calendar,
    staff: [
      {
        username: manager.session!.username,
        displayName: manager.session!.displayName,
        role: 'MANAGER',
        temporaryPassword: null,
      },
    ],
    userIds: { manager: manager.session!.userId, receptionists: [] },
    therapists: [],
    services: { OT: '', SP: '', PL: '' },
    families: [],
    tariffs: [],
    shareRules: [],
    sessions: [],
    charges: new Map(),
    payments: [],
    promises: [],
    periods: [],
    websiteRequests: [],
    audited: new Map(),
    exports: [],
    acts: { MANAGER: {}, RECEPTIONIST: {}, VISITOR: {} },
    scenario: {},
  };

  const routes = new Map<string, RouteEntry>(
    collectRoutes(AppModule).map((route) => [`${route.method} ${route.path}`, route]),
  );

  /** One act, by one person, through one route's authority. */
  async function act<T>(person: Person, route: string, run: () => Promise<T>): Promise<T> {
    const entry = routes.get(route);
    if (entry === undefined) throw new Error(`Simulation names an unknown route: ${route}`);

    const allowed =
      person.role === 'VISITOR'
        ? visitorVerdict(entry) !== 'no'
        : verdict(entry.access, person.role) === 'yes';
    if (!allowed) throw new Error(`The ${person.label} may not ${route}; the simulation is wrong.`);

    const counts = book.acts[person.role];
    counts[route] = (counts[route] ?? 0) + 1;
    return run();
  }

  const audited = (id: string) => book.audited.set(id, (book.audited.get(id) ?? 0) + 1);
  const count = (key: string, by = 1) => (book.scenario[key] = (book.scenario[key] ?? 0) + by);
  const ctx = requestContext;
  const s = (person: Person) => person.session!;

  // ---- staff -----------------------------------------------------------------

  const receptionists: Person[] = [];
  for (const [index, shift] of ['صبح', 'عصر'].entries()) {
    const username = `practice_reception_${index + 1}`;
    const created = await act(manager, 'POST /users', () =>
      svc.users.create(
        createUserRequestSchema.parse({
          username,
          displayName: `پذیرش نمونه (${shift})`,
          role: 'RECEPTIONIST',
        }),
        s(manager),
        ctx(),
      ),
    );
    book.staff.push({
      username,
      displayName: created.user.displayName,
      role: 'RECEPTIONIST',
      temporaryPassword: created.temporaryPassword,
    });
    book.userIds.receptionists.push(created.user.id);
    receptionists.push({
      role: 'RECEPTIONIST',
      session: sessionFor(created.user.id, username, created.user.displayName, 'RECEPTIONIST'),
      label: `receptionist ${index + 1}`,
    });
  }

  const desk = (day: string): Person => receptionists[dayIndex(ws, day) % 2]!;
  const visitor: Person = { role: 'VISITOR', session: null, label: 'visitor' };

  // ---- catalog (manager) -------------------------------------------------------

  const serviceDefs = [
    { key: 'OT' as const, name: 'کاردرمانی (نمونه)', durations: [30, 45, 60] },
    { key: 'SP' as const, name: 'گفتاردرمانی (نمونه)', durations: [45, 60] },
    { key: 'PL' as const, name: 'بازی‌درمانی (نمونه)', durations: [45] },
  ];
  for (const def of serviceDefs) {
    const created = await act(manager, 'POST /catalog/services', () =>
      svc.services.create(
        createServiceRequestSchema.parse({
          name: def.name,
          publicDescription: null,
          isPublic: false,
          allowedDurationsMinutes: def.durations,
        }),
        s(manager),
        ctx(),
      ),
    );
    book.services[def.key] = created.service.id;
  }
  const { OT, SP, PL } = book.services;

  // One public service, so the contact form has something to name.
  const ot = await act(manager, 'GET /catalog/services/:id', () => svc.services.get(OT));
  const publicSlug = 'practice-occupational-therapy';
  await act(manager, 'PATCH /catalog/services/:id', () =>
    svc.services.update(
      OT,
      {
        name: ot.name,
        publicDescription: 'شرح نمونه برای محیط تمرین؛ متن واقعی کلینیک نیست.',
        isPublic: true,
        publicSlug,
        allowedDurationsMinutes: ot.allowedDurationsMinutes,
      },
      s(manager),
      ctx(),
    ),
  );

  const roomIds: string[] = [];
  for (const index of [1, 2, 3]) {
    const room = await act(manager, 'POST /catalog/rooms', () =>
      svc.rooms.create(
        createRoomRequestSchema.parse({
          name: `اتاق نمونه ${index}`,
          allowedServiceIds: [OT, SP, PL],
        }),
        s(manager),
        ctx(),
      ),
    );
    roomIds.push(room.id);
  }

  // Three therapists. The third works afternoons only and does NOT share in
  // concessions: every concession on their sessions is clinic-borne, even when
  // that takes the clinic's net below zero.
  const therapistDefs = [
    {
      label: 'الف',
      services: [OT, PL],
      hours: DAY_HOURS,
      window: ['09:00', '18:00'],
      shares: true,
    },
    { label: 'ب', services: [SP, OT], hours: DAY_HOURS, window: ['09:00', '18:00'], shares: false },
    {
      label: 'ج',
      services: [PL, SP],
      hours: AFTERNOON_HOURS,
      window: ['12:00', '18:00'],
      shares: false,
    },
  ] as const;
  const therapistIds: string[] = [];
  for (const def of therapistDefs) {
    const therapist = await act(manager, 'POST /catalog/therapists', () =>
      svc.therapists.create(
        createTherapistRequestSchema.parse({
          fullName: `درمانگر نمونه ${def.label}`,
          specialty: 'تخصص نمونه',
          supportedServiceIds: [...def.services],
        }),
        s(manager),
        ctx(),
      ),
    );
    await act(manager, 'PUT /availability/therapists/:therapistId/windows', () =>
      svc.availability.replaceWindows(
        therapist.id,
        replaceAvailabilityWindowsRequestSchema.parse({
          windows: [0, 1, 2, 3, 4].map((weekday) => ({
            weekday,
            startTime: def.window[0],
            endTime: def.window[1],
          })),
        }),
        s(manager),
        ctx(),
      ),
    );
    therapistIds.push(therapist.id);
    book.therapists.push({ id: therapist.id, label: def.label, sharesDiscounts: def.shares });
  }
  const [T1, T2, T3] = therapistIds as [string, string, string];

  // ---- prices (manager) --------------------------------------------------------
  //
  // The occupational-therapy price rises on the first day of the closed month,
  // so the closed month and the weeks before it are priced differently and a
  // reconciled charge proves which price it took. Sixty-minute speech therapy
  // has NO price until three weeks in: those sessions complete unpriced and are
  // charged afterwards by an explicit re-post.
  const priceFrom = addDays(ws, -60);

  async function createTariff(tariff: BookTariff, freeReason?: string): Promise<void> {
    const created = await act(manager, 'POST /catalog/tariffs', () =>
      svc.tariffs.create(
        createTariffRequestSchema.parse(
          tariff.priceMode === 'FREE'
            ? {
                priceMode: 'FREE',
                serviceId: tariff.serviceId,
                durationMinutes: tariff.durationMinutes,
                therapistId: tariff.therapistId,
                effectiveStart: tariff.from,
                effectiveEnd: tariff.to,
                freeReason,
                confirmFreePrice: true,
              }
            : {
                priceMode: 'PAID',
                serviceId: tariff.serviceId,
                durationMinutes: tariff.durationMinutes,
                therapistId: tariff.therapistId,
                effectiveStart: tariff.from,
                effectiveEnd: tariff.to,
                priceToman: tariff.priceToman.toString(),
              },
        ),
        s(manager),
        ctx(),
      ),
    );
    audited(created.id);
    book.tariffs.push(tariff);
  }

  const paid = (
    serviceId: string,
    minutes: number,
    price: number,
    from: string,
    to: string | null = null,
    therapistId: string | null = null,
  ): BookTariff => ({
    serviceId,
    durationMinutes: minutes,
    therapistId,
    priceMode: 'PAID',
    priceToman: BigInt(price),
    from,
    to,
  });

  await createTariff(paid(OT, 45, 300_000, priceFrom, addDays(M1, -1)));
  await createTariff(paid(OT, 60, 420_000, priceFrom));
  await createTariff(
    {
      serviceId: OT,
      durationMinutes: 30,
      therapistId: null,
      priceMode: 'FREE',
      priceToman: 0n,
      from: priceFrom,
      to: null,
    },
    'جلسهٔ ارزیابی رایگان (نمونه)',
  );
  await createTariff(paid(SP, 45, 350_000, priceFrom));
  // A therapist-specific price for the same service and length: it wins.
  await createTariff(paid(SP, 45, 380_000, priceFrom, null, T2));
  // 285,000 at T3's 33.33% is 94,990.5: the half-up rule decides a whole toman.
  await createTariff(paid(PL, 45, 285_000, priceFrom));

  // ---- share rules (manager) -----------------------------------------------------
  //
  // T1 40%, sharing concessions. T2 is entered as 30% BY MISTAKE and corrected
  // to 35% ten days in, with every session already rated corrected after it.
  // T3 has no rule at all until the middle of the closed month — their
  // sessions are charged and stay UNRATED until the manager rates them.

  async function createShareRule(
    therapistId: string,
    basisPoints: number,
    from: string,
    to: string | null,
    supersedes?: BookShareRule,
    reason?: string,
  ): Promise<BookShareRule> {
    const created = await act(manager, 'POST /settlement/share-rules', () =>
      svc.shareRules.create(
        createShareRuleRequestSchema.parse({
          therapistId,
          shareBasisPoints: basisPoints,
          effectiveStart: from,
          effectiveEnd: to,
          ...(supersedes === undefined ? {} : { supersedesShareRuleId: supersedes.id, reason }),
        }),
        s(manager),
        ctx(),
      ),
    );
    audited(created.id);
    if (supersedes !== undefined) {
      supersedes.voided = true;
      audited(supersedes.id);
    }
    const rule = { id: created.id, therapistId, basisPoints, from, to, voided: false };
    book.shareRules.push(rule);
    return rule;
  }

  let t1Rule = await createShareRule(T1, 4000, priceFrom, null);
  const t2MistakenRule = await createShareRule(T2, 3000, priceFrom, null);

  // ---- families and children (receptionists) ----------------------------------

  const childKeys: { familyIndex: number; childId: string; letter: string }[] = [];

  async function registerFamily(index: number, by: Person, extraGuardian?: { mobile: string }) {
    const tree = TREES[index]!;
    const guardians = [
      {
        fullName: `سرپرست نمونه ${tree}`,
        relationship: index % 2 === 0 ? 'MOTHER' : 'FATHER',
        relationshipNote: null,
        mobile: mobile(index + 1),
        // Families 6 and 7 share a landline: an informational notice, never a block.
        landline: index === 6 || index === 7 ? '02100000067' : null,
        isPrimaryContact: true,
      },
      ...(extraGuardian === undefined
        ? []
        : [
            {
              fullName: 'مادربزرگ نمونه',
              relationship: 'GRANDMOTHER',
              relationshipNote: null,
              mobile: extraGuardian.mobile,
              landline: null,
              isPrimaryContact: false,
            },
          ]),
    ];
    const request = createFamilyRequestSchema.parse({
      familyName: `خانوادهٔ نمونه ${tree}`,
      address: null,
      note: null,
      guardians,
    });

    try {
      const created = await act(by, 'POST /families', () =>
        svc.families.create(request, s(by), ctx()),
      );
      if (created.nonBlockingWarnings.length > 0) count('family registered with a notice');
      return created.family.id;
    } catch (error) {
      // The two families that share a grandmother's mobile: a real, separate
      // family, acknowledged and registered.
      const blocked = duplicateDraft(error, 'FAMILY_POSSIBLE_DUPLICATE');
      count('family duplicate acknowledged');
      const confirmed = await act(by, 'POST /families/confirm-registration', () =>
        svc.families.confirmRegistration(blocked.draftToken, blocked.candidateIds, s(by), ctx()),
      );
      return confirmed.family.id;
    }
  }

  async function addChild(familyIndex: number, familyId: string, childIndex: number, by: Person) {
    const tree = TREES[familyIndex]!;
    const letter = LETTERS[childIndex]!;
    const created = await act(by, 'POST /families/:familyId/children', () =>
      svc.children.create(
        familyId,
        createChildRequestSchema.parse({
          firstName: `نمونه ${letter}`,
          lastName: tree,
          birthDate: addDays(today, -(1_300 + familyIndex * 97 + childIndex * 430)),
          sex: (familyIndex + childIndex) % 2 === 0 ? 'FEMALE' : 'MALE',
          nationalId: null,
          legacyPaperFileNumber: null,
          referralSource: null,
          note: null,
        }),
        s(by),
        ctx(),
      ),
    );
    childKeys.push({ familyIndex, childId: created.child.id, letter });
    book.families[familyIndex]!.childIds.push(created.child.id);
    return created.child.id;
  }

  for (let index = 0; index < CONVERTED_FAMILY; index += 1) {
    const by = receptionists[index % 2]!;
    // Family 10 lists family 9's grandmother as a second guardian.
    const familyId = await registerFamily(
      index,
      by,
      index === 9 || index === 10 ? { mobile: mobile(900) } : undefined,
    );
    book.families[index] = { id: familyId, label: TREES[index]!, childIds: [] };
    await addChild(index, familyId, 0, by);
  }

  // The returning family registered a second time for its second child: the
  // mobile blocks it, the colleague discards the duplicate draft and adds the
  // child to the family that already exists.
  try {
    await act(receptionists[1]!, 'POST /families', () =>
      svc.families.create(
        createFamilyRequestSchema.parse({
          familyName: `خانوادهٔ نمونه ${TREES[0]}`,
          address: null,
          note: null,
          guardians: [
            {
              fullName: `سرپرست نمونه ${TREES[0]}`,
              relationship: 'MOTHER',
              relationshipNote: null,
              mobile: mobile(1),
              landline: null,
              isPrimaryContact: true,
            },
          ],
        }),
        s(receptionists[1]!),
        ctx(),
      ),
    );
    throw new Error('A second registration on a known mobile was not blocked.');
  } catch (error) {
    const blocked = duplicateDraft(error, 'FAMILY_POSSIBLE_DUPLICATE');
    await act(receptionists[1]!, 'POST /registration-drafts/discard', () =>
      svc.drafts.discard(blocked.draftToken, s(receptionists[1]!)),
    );
    count('family duplicate discarded');
  }

  for (const index of TWO_CHILD_FAMILIES) {
    const family = book.families[index]!;
    await addChild(index, family.id, 1, receptionists[(index + 1) % 2]!);
  }

  // The same child entered twice in one family: blocked, and discarded.
  try {
    const family = book.families[3]!;
    await act(receptionists[0]!, 'POST /families/:familyId/children', () =>
      svc.children.create(
        family.id,
        createChildRequestSchema.parse({
          firstName: `نمونه ${LETTERS[1]}`,
          lastName: TREES[3],
          birthDate: addDays(today, -(1_300 + 3 * 97 + 430)),
          sex: 'FEMALE',
          nationalId: null,
          legacyPaperFileNumber: null,
          referralSource: null,
          note: null,
        }),
        s(receptionists[0]!),
        ctx(),
      ),
    );
    throw new Error('A child entered twice was not blocked.');
  } catch (error) {
    const blocked = duplicateDraft(error, 'CHILD_POSSIBLE_DUPLICATE');
    await act(receptionists[0]!, 'POST /registration-drafts/discard', () =>
      svc.drafts.discard(blocked.draftToken, s(receptionists[0]!)),
    );
    count('child duplicate discarded');
  }

  // ---- the diary: weekly series (receptionists) -----------------------------------

  const familyOfChild = new Map<string, string>();
  for (const family of book.families) {
    for (const childId of family.childIds) familyOfChild.set(childId, family.id);
  }

  const taken = new Set<string>();
  const slotKey = (therapistId: string, weekday: number, hour: number) =>
    `${therapistId}:${weekday}:${hour}`;
  const therapistHours = (therapistId: string) =>
    therapistDefs[therapistIds.indexOf(therapistId)]!.hours;
  const roomOf = (therapistId: string) => roomIds[therapistIds.indexOf(therapistId)]!;

  /** First date on or after `from` that falls on `weekday` (0 = Saturday). */
  const nextWeekday = (from: string, weekday: number) =>
    addDays(from, (weekday - clinicWeekday(from) + 7) % 7);

  function freeHour(therapistId: string, weekday: number, offset: number, childBusy: Set<string>) {
    const hours = therapistHours(therapistId);
    for (let step = 0; step < hours.length; step += 1) {
      const hour = hours[(offset + step) % hours.length]!;
      if (!taken.has(slotKey(therapistId, weekday, hour)) && !childBusy.has(`${weekday}:${hour}`)) {
        return hour;
      }
    }
    throw new Error('The synthetic diary is full; widen the hours.');
  }

  const childBusy = new Map<string, Set<string>>();

  function recordSessions(detail: AppointmentDetail[], seriesId: string | null, serviceId: string) {
    for (const occurrence of detail) {
      const participant = occurrence.participants[0]!;
      book.sessions.push({
        appointmentId: occurrence.appointment.id,
        participantId: participant.id,
        seriesId,
        childId: participant.childId,
        familyId: familyOfChild.get(participant.childId)!,
        therapistId: occurrence.appointment.therapistId,
        serviceId,
        roomId: occurrence.appointment.roomId,
        date: tehranDate(occurrence.appointment.startsAt),
        startsAt: occurrence.appointment.startsAt,
        durationMinutes: occurrence.appointment.durationMinutes,
        status: 'SCHEDULED',
        attendance: 'PENDING',
        chargeId: null,
      });
    }
  }

  async function bookSeries(
    by: Person,
    plan: {
      childId: string;
      therapistId: string;
      serviceId: string;
      minutes: number;
      weekday: number;
      offset: number;
      from: string;
    },
    requested?: { weekday: number; hour: number },
  ) {
    const busy = childBusy.get(plan.childId) ?? new Set<string>();
    childBusy.set(plan.childId, busy);

    const requestFor = (weekday: number, hour: number) =>
      createAppointmentSeriesRequestSchema.parse({
        serviceId: plan.serviceId,
        durationMinutes: plan.minutes,
        therapistId: plan.therapistId,
        roomId: roomOf(plan.therapistId),
        childId: plan.childId,
        startsAt: tehranInstant(nextWeekday(plan.from, weekday), hour),
        note: null,
        availabilityOverrideReason: null,
        recurrence: { endMode: 'END_DATE', intervalWeeks: 1, endsOn: calendar.bookedUntil },
      });

    if (requested !== undefined) {
      // The family asked for an hour another child already holds every week.
      // The preview says so before anything is written, and the desk offers the
      // next free hour instead.
      const preview = await act(by, 'POST /appointment-series/preview', () =>
        svc.series.preview(requestFor(requested.weekday, requested.hour), s(by)),
      );
      if (preview.bookable || preview.blockedCount === 0) {
        throw new Error('A recurring booking on a taken hour previewed as bookable.');
      }
      count('recurring conflict previewed and avoided');
    }

    const hour = freeHour(plan.therapistId, plan.weekday, plan.offset, busy);
    const request = requestFor(plan.weekday, hour);
    await act(by, 'POST /appointment-series/preview', () => svc.series.preview(request, s(by)));
    const created = await act(by, 'POST /appointment-series', () =>
      svc.series.create(request, s(by), ctx()),
    );
    taken.add(slotKey(plan.therapistId, plan.weekday, hour));
    busy.add(`${plan.weekday}:${hour}`);
    recordSessions(created.occurrences, created.series.id, plan.serviceId);
    count('weekly series booked');
    return created.series.id;
  }

  const primaryService = [OT, SP, PL];
  const secondary = [
    { therapist: T2, service: OT },
    { therapist: T3, service: SP },
    { therapist: T1, service: PL },
  ];
  let planIndex = 0;
  const seriesOfChild = new Map<string, string[]>();
  for (const { childId } of childKeys) {
    const therapistId = therapistIds[planIndex % 3]!;
    const by = receptionists[planIndex % 2]!;
    const requested = planIndex === 7 ? firstTakenSlot(taken, T2, therapistHours) : undefined;
    const seriesIds = [
      await bookSeries(
        by,
        {
          childId,
          therapistId,
          serviceId: primaryService[planIndex % 3]!,
          // One child's speech therapy is an hour long, which has no price yet.
          minutes: planIndex === 4 ? 60 : 45,
          weekday: (planIndex * 2) % 5,
          offset: planIndex,
          from: ws,
        },
        requested,
      ),
    ];
    if (planIndex % 4 === 0) {
      const extra = secondary[planIndex % 3]!;
      seriesIds.push(
        await bookSeries(by, {
          childId,
          therapistId: extra.therapist,
          serviceId: extra.service,
          minutes: 45,
          weekday: (planIndex * 2 + 2) % 5,
          offset: planIndex + 3,
          from: ws,
        }),
      );
    }
    seriesOfChild.set(childId, seriesIds);
    planIndex += 1;
  }

  // ---- money helpers -----------------------------------------------------------

  const priceFor = (serviceId: string, minutes: number, therapistId: string, day: string) => {
    const covers = (tariff: BookTariff) =>
      tariff.serviceId === serviceId &&
      tariff.durationMinutes === minutes &&
      tariff.from <= day &&
      (tariff.to === null || day <= tariff.to);
    return (
      book.tariffs.find((tariff) => covers(tariff) && tariff.therapistId === therapistId) ??
      book.tariffs.find((tariff) => covers(tariff) && tariff.therapistId === null)
    );
  };

  const ruleFor = (therapistId: string, day: string) =>
    book.shareRules.find(
      (rule) =>
        !rule.voided &&
        rule.therapistId === therapistId &&
        rule.from <= day &&
        (rule.to === null || day <= rule.to),
    );

  const effective = (charge: BookCharge) =>
    charge.voided
      ? 0n
      : charge.expectedAmountToman -
        charge.adjustments
          .filter((adjustment) => !adjustment.voided)
          .reduce((sum, adjustment) => sum + adjustment.amountToman, 0n);

  const due = (familyId: string) =>
    [...book.charges.values()]
      .filter((charge) => charge.familyId === familyId)
      .reduce((sum, charge) => sum + effective(charge), 0n) -
    book.payments
      .filter((payment) => payment.familyId === familyId && !payment.voided)
      .reduce((sum, payment) => sum + payment.amountToman, 0n);

  /** Reads the charge the application raised for a seat, as the session screen does. */
  async function noteCharge(by: Person, session: BookSession, posted?: { id: string }) {
    const charge =
      posted ??
      (
        await act(by, 'GET /session-charges/participants/:participantId', () =>
          svc.charges.readForParticipant(session.participantId),
        )
      ).charge;
    const tariff = priceFor(
      session.serviceId,
      session.durationMinutes,
      session.therapistId,
      session.date,
    )!;
    const rule = ruleFor(session.therapistId, session.date);
    session.chargeId = charge.id;
    book.charges.set(charge.id, {
      id: charge.id,
      participantId: session.participantId,
      familyId: session.familyId,
      childId: session.childId,
      therapistId: session.therapistId,
      serviceId: session.serviceId,
      serviceDate: session.date,
      durationMinutes: session.durationMinutes,
      expectedAmountToman: tariff.priceToman,
      priceMode: tariff.priceMode,
      voided: false,
      adjustments: [],
      rating: rule === undefined ? null : { basisPoints: rule.basisPoints, via: 'AUTOMATIC' },
    });
    audited(charge.id);
    return book.charges.get(charge.id)!;
  }

  const isPriced = (session: BookSession) =>
    priceFor(session.serviceId, session.durationMinutes, session.therapistId, session.date) !==
    undefined;

  async function attend(by: Person, session: BookSession, attendance: 'ATTENDED' | 'NO_SHOW') {
    await act(by, 'PUT /appointments/:id/participants/:participantId/attendance', () =>
      svc.appointments.recordAttendance(
        session.appointmentId,
        session.participantId,
        recordAttendanceRequestSchema.parse({ attendance }),
        s(by),
        ctx(),
      ),
    );
    session.attendance = attendance;
  }

  async function complete(by: Person, session: BookSession) {
    await act(by, 'POST /appointments/:id/complete', () =>
      svc.appointments.complete(session.appointmentId, s(by), ctx()),
    );
    session.status = 'COMPLETED';
    if (session.attendance === 'ATTENDED' && isPriced(session)) await noteCharge(by, session);
  }

  async function cancel(
    by: Person,
    session: BookSession,
    party: 'FAMILY' | 'CLINIC',
    reason: string,
  ) {
    await act(by, 'POST /appointments/:id/cancel', () =>
      svc.appointments.cancel(
        session.appointmentId,
        cancelAppointmentRequestSchema.parse({ cancelledBy: party, reason }),
        s(by),
        ctx(),
      ),
    );
    session.status = party === 'FAMILY' ? 'CANCELLED_BY_FAMILY' : 'CANCELLED_BY_CLINIC';
  }

  async function concede(
    charge: BookCharge,
    amount: bigint,
    therapistPortion: bigint,
    reason: string,
  ) {
    const known = new Set(charge.adjustments.map((adjustment) => adjustment.id));
    const result = await act(manager, 'POST /session-charges/:chargeId/adjustments', () =>
      svc.adjustments.create(
        charge.id,
        createChargeAdjustmentRequestSchema.parse({
          amountToman: amount.toString(),
          reason,
          ...(therapistPortion > 0n ? { therapistDiscountToman: therapistPortion.toString() } : {}),
        }),
        s(manager),
        ctx(),
      ),
    );
    const created = result.charge.adjustments.find((adjustment) => !known.has(adjustment.id))!;
    charge.adjustments.push({
      id: created.id,
      amountToman: amount,
      therapistPortionToman: therapistPortion,
      voided: false,
    });
    audited(created.id);
    count(
      therapistPortion === 0n
        ? 'concession clinic-borne'
        : therapistPortion === amount
          ? 'concession therapist-borne'
          : 'concession split',
    );
    return created.id;
  }

  async function voidCharge(charge: BookCharge, reason: string) {
    await act(manager, 'POST /session-charges/:id/void', () =>
      svc.charges.void(charge.id, reason, s(manager), ctx()),
    );
    charge.voided = true;
    audited(charge.id);
    const session = book.sessions.find((one) => one.chargeId === charge.id);
    if (session !== undefined) session.chargeId = null;
    count('charge voided');
  }

  async function pay(
    by: Person,
    familyId: string,
    amount: bigint,
    method: PaymentMethod,
    receivedOn: string,
  ): Promise<BookPayment> {
    const recorded = await act(by, 'POST /families/:id/payments', () =>
      svc.payments.record(
        familyId,
        createPaymentRequestSchema.parse({ amountToman: amount.toString(), method, receivedOn }),
        s(by),
        ctx(),
      ),
    );
    const payment: BookPayment = {
      id: recorded.payment.id,
      familyId,
      amountToman: amount,
      method,
      receivedOn,
      recordedByUserId: s(by).userId,
      voided: false,
    };
    book.payments.push(payment);
    audited(payment.id);
    return payment;
  }

  async function promise(by: Person, familyId: string, amount: bigint, dueOn: string) {
    const created = await act(by, 'POST /families/:id/promises', () =>
      svc.promises.create(
        familyId,
        createPromiseRequestSchema.parse({ amountToman: amount.toString(), dueOn }),
        s(by),
        ctx(),
      ),
    );
    const record: BookPromise = {
      id: created.promise.id,
      familyId,
      amountToman: amount,
      dueOn,
      status: 'OPEN',
    };
    book.promises.push(record);
    audited(record.id);
    return record;
  }

  async function rateExplicitly(charge: BookCharge, reason: string) {
    const rule = ruleFor(charge.therapistId, charge.serviceDate)!;
    const rated = await act(manager, 'POST /settlement/session-charges/:chargeId/rating', () =>
      svc.ratings.rate(charge.id, rateSessionRequestSchema.parse({ reason }), s(manager), ctx()),
    );
    audited(rated.id);
    charge.rating = { basisPoints: rule.basisPoints, via: 'EXPLICIT' };
    count('session rated explicitly');
  }

  // ---- the days ------------------------------------------------------------------

  const fired = new Set<string>();
  const once = (name: string, from: string, day: string) =>
    day >= from && !fired.has(name) ? (fired.add(name), true) : false;

  const followUps: BookSession[] = [];
  let sequence = 0;
  const p3: { first?: BookPromise; second?: BookPromise; third?: BookPromise } = {};
  let closed = false;
  const closeDay =
    calendar.lastHistoryDay < addDays(M2, 2) ? calendar.lastHistoryDay : addDays(M2, 2);
  const postedToday = new Map<string, BookCharge[]>();

  async function closeMonth() {
    const { from, to } = calendar.closedMonth;

    // Before closing, the manager rates the afternoon therapist's outstanding
    // sessions of the month — all but the last two, which nobody gets to and
    // which the close therefore counts as excluded.
    const unrated = [...book.charges.values()]
      .filter(
        (charge) =>
          charge.therapistId === T3 &&
          !charge.voided &&
          charge.rating === null &&
          charge.serviceDate <= to,
      )
      .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate));
    for (const charge of unrated.slice(0, Math.max(unrated.length - 2, 0))) {
      await rateExplicitly(charge, 'امتیازدهی پیش از بستن دوره (نمونه)');
    }

    for (const therapistId of therapistIds) {
      const request = closeSettlementPeriodRequestSchema.parse({ therapistId, from, to });
      const result = await act(manager, 'POST /settlement/periods', () =>
        svc.close.close(request, s(manager), ctx()),
      );
      audited(result.period.id);
      const detail = await act(manager, 'GET /settlement/periods/:id/lines', () =>
        svc.close.detail(result.period.id),
      );
      const inRange = [...book.charges.values()].filter(
        (charge) =>
          charge.therapistId === therapistId &&
          charge.serviceDate >= from &&
          charge.serviceDate <= to,
      );
      book.periods.push({
        id: result.period.id,
        therapistId,
        from,
        to,
        linesAtClose: detail.lines,
        expectedLines: inRange
          .filter((charge) => !charge.voided && charge.rating !== null)
          .map((charge) => expectedSessionValue(charge)!),
        expectedUnrated: inRange.filter((charge) => !charge.voided && charge.rating === null)
          .length,
      });
    }

    // The form submitted twice: the second answer is the period that exists.
    const again = await act(manager, 'POST /settlement/periods', () =>
      svc.close.close(
        closeSettlementPeriodRequestSchema.parse({ therapistId: T1, from, to }),
        s(manager),
        ctx(),
      ),
    );
    if (again.outcome !== 'ALREADY_CLOSED') throw new Error('A repeated close was not idempotent.');
    count('close repeated idempotently');

    // Month-end exports, the manager's files for the accountant.
    const payments = await act(manager, 'GET /reports/payments/export', () =>
      svc.exports.payments(paymentReportExportQuerySchema.parse({ from, to }), s(manager), ctx()),
    );
    book.exports.push({
      label: 'payments',
      csv: payments.csv,
      rowCount: payments.rowCount,
      range: { from, to },
    });
    closed = true;
  }

  async function afterClose() {
    const { from, to } = calendar.closedMonth;
    const monthCharges = (therapistId: string) =>
      [...book.charges.values()].filter(
        (charge) =>
          charge.therapistId === therapistId &&
          !charge.voided &&
          charge.serviceDate >= from &&
          charge.serviceDate <= to &&
          charge.priceMode === 'PAID',
      );

    // A session of the closed month found to have been entered twice for a
    // child who came once: withdrawn after its period closed.
    const duplicate = monthCharges(T1).find((charge) => charge.adjustments.length === 0)!;
    await voidCharge(duplicate, 'ثبت تکراری جلسه، پس از بستن دوره پیدا شد (نمونه)');
    count('charge voided after close');

    // A concession granted late on a closed-month session, half borne by the
    // therapist who shares in concessions.
    const late = monthCharges(T1).find(
      (charge) => charge.adjustments.length === 0 && charge.id !== duplicate.id,
    )!;
    await concede(late, 60_000n, 30_000n, 'تخفیف دیرهنگام پس از بستن دوره (نمونه)');
    count('concession after close');

    // The two sessions nobody rated before the close are rated now.
    for (const charge of [...book.charges.values()].filter(
      (one) =>
        one.therapistId === T3 && !one.voided && one.rating === null && one.serviceDate <= to,
    )) {
      await rateExplicitly(charge, 'امتیازدهی پس از بستن دوره (نمونه)');
      count('rated after close');
    }
  }

  for (let day = ws; day <= calendar.lastHistoryDay; day = addDays(day, 1)) {
    const front = desk(day);
    const other = receptionists[(dayIndex(ws, day) + 1) % 2]!;
    postedToday.clear();

    // ---- configuration and settlement events, when their day comes ----

    if (once('ot-price-rise', addDays(M1, -3), day)) {
      await createTariff(paid(OT, 45, 330_000, M1));
      count('tariff price rise');
    }

    if (once('sp60-price', addDays(ws, 20), day)) {
      // The hour-long speech sessions have been completing unpriced. The price
      // is entered with the effective date it always should have had, and the
      // desk charges each of them by an explicit re-post — twice, the second
      // time answering that the charge already exists.
      await createTariff(paid(SP, 60, 450_000, priceFrom));
      for (const session of book.sessions.filter(
        (one) =>
          one.durationMinutes === 60 &&
          one.serviceId === SP &&
          one.status === 'COMPLETED' &&
          one.attendance === 'ATTENDED' &&
          one.chargeId === null,
      )) {
        const posted = await act(front, 'POST /session-charges/participants/:participantId', () =>
          svc.charges.post(session.participantId, s(front), ctx()),
        );
        if (posted.outcome !== 'POSTED') throw new Error('A re-post after pricing did not post.');
        await noteCharge(front, session, posted.charge);
        const again = await act(front, 'POST /session-charges/participants/:participantId', () =>
          svc.charges.post(session.participantId, s(front), ctx()),
        );
        if (again.outcome !== 'ALREADY_POSTED' || again.charge.id !== posted.charge.id) {
          throw new Error('A repeated post raised a second charge.');
        }
        count('unpriced session charged after pricing');
        count('charge post retried');
      }
    }

    if (once('t2-share-correction', addDays(ws, 10), day)) {
      // T2's percentage was entered as 30% and should have been 35%. The rule is
      // corrected, then every session already rated under it is corrected.
      await createShareRule(
        T2,
        3500,
        priceFrom,
        null,
        t2MistakenRule,
        'درصد اشتباه وارد شده بود (نمونه)',
      );
      for (const charge of [...book.charges.values()].filter(
        (one) => one.therapistId === T2 && !one.voided && one.rating?.basisPoints === 3000,
      )) {
        const current = await act(manager, 'GET /settlement/session-charges/:chargeId/rating', () =>
          svc.ratings.read(charge.id),
        );
        const corrected = await act(manager, 'POST /settlement/rating-corrections', () =>
          svc.ratings.correct(
            correctSessionRatingRequestSchema.parse({
              sessionChargeId: charge.id,
              sessionSettlementId: current.id,
              withdrawReason: 'درصد قرارداد اصلاح شد (نمونه)',
              replacement: { sessionChargeId: charge.id, reason: 'اعمال درصد اصلاح‌شده (نمونه)' },
            }),
            s(manager),
            ctx(),
          ),
        );
        audited(current.id);
        audited(corrected.id);
        charge.rating = { basisPoints: 3500, via: 'EXPLICIT' };
        count('rating corrected');
      }
    }

    if (once('t3-rule', addDays(M1, 12), day)) {
      // The afternoon therapist's agreement is finally entered, back-dated, and
      // the manager rates their sessions so far — except the two latest of the
      // closed month, which wait until after the close.
      await createShareRule(T3, 3333, priceFrom, null);
      const unrated = [...book.charges.values()]
        .filter((charge) => charge.therapistId === T3 && !charge.voided && charge.rating === null)
        .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate));
      const waiting = new Set(
        unrated
          .filter((charge) => charge.serviceDate >= M1)
          .slice(-2)
          .map((charge) => charge.id),
      );
      for (const charge of unrated.filter((one) => !waiting.has(one.id))) {
        await rateExplicitly(charge, 'امتیازدهی پس از ثبت قرارداد (نمونه)');
      }
    }

    if (M2 <= calendar.lastHistoryDay && once('t1-raise', M2, day)) {
      // T1's share rises from this month. The open rule is ended the day before
      // and a new one starts; nothing already rated moves.
      t1Rule = await createShareRule(
        T1,
        4000,
        priceFrom,
        addDays(M2, -1),
        t1Rule,
        'پایان قرارداد قبلی (نمونه)',
      );
      await createShareRule(T1, 4500, M2, null);
      count('share rule changed over time');
    }

    // ---- the website inbox ----

    if (once('w1', addDays(ws, 2), day)) {
      await submitEnquiry(9001, publicSlug, 5, 'FEMALE', 1);
    }
    if (once('w1-convert', addDays(ws, 3), day)) {
      const request = await inboxRequest(9001);
      await setRequestStatus(front, request, 'CONTACTED');
      // A new family: registered at the desk the ordinary way, then linked.
      const familyId = await registerFamily(CONVERTED_FAMILY, front);
      book.families[CONVERTED_FAMILY] = {
        id: familyId,
        label: TREES[CONVERTED_FAMILY]!,
        childIds: [],
      };
      const childId = await addChild(CONVERTED_FAMILY, familyId, 0, front);
      familyOfChild.set(childId, familyId);
      await linkRequest(front, request, familyId);
      // A free assessment first, then weekly sessions.
      const assessmentDay = nextWeekday(addDays(day, 2), 1);
      const created = await bookSingle(front, {
        childId,
        therapistId: T1,
        serviceId: OT,
        minutes: 30,
        day: assessmentDay,
      });
      recordSessions([created], null, OT);
      seriesOfChild.set(childId, [
        await bookSeries(front, {
          childId,
          therapistId: T1,
          serviceId: OT,
          minutes: 45,
          weekday: 3,
          offset: 2,
          from: addDays(assessmentDay, 1),
        }),
      ]);
      count('website request converted to a new family');
    }
    if (once('w2', addDays(ws, 8), day)) await submitEnquiry(9002, null, 6, 'MALE', 2, mobile(1));
    if (once('w2-link', addDays(ws, 9), day)) {
      const request = await inboxRequest(mobile(1));
      await linkRequest(front, request, book.families[0]!.id);
      count('website request linked to an existing family');
    }
    if (once('w3', addDays(M1, 4), day)) await submitEnquiry(9003, publicSlug, 4, 'MALE', 3);
    if (once('w3-close', addDays(M1, 6), day)) {
      const request = await inboxRequest(9003);
      await setRequestStatus(front, request, 'CONTACTED');
      await setRequestStatus(front, request, 'CLOSED');
    }
    if (once('w4', addDays(M1, 10), day)) await submitEnquiry(9004, null, 7, 'FEMALE', 4);
    if (once('w4-follow', addDays(M1, 12), day)) {
      const request = await inboxRequest(9004);
      await setRequestStatus(front, request, 'CONTACTED');
      await setRequestStatus(front, request, 'FOLLOW_UP_NEEDED');
    }
    if (once('w5', addDays(today, -2), day)) {
      await submitEnquiry(9005, publicSlug, 3, 'FEMALE', 5);
      // The same parent presses submit again from another network: absorbed.
      await submitEnquiry(9005, publicSlug, 3, 'FEMALE', 6, undefined, false);
      count('repeated enquiry absorbed');
    }

    // ---- yesterday's loose ends ----

    for (const [index, session] of followUps.splice(0).entries()) {
      // Completed in a batch with the outcome still open; the child DID come.
      // The arrival is recorded and the charge is raised explicitly — once by
      // two colleagues at the same moment, which must still raise one charge.
      await attend(front, session, 'ATTENDED');
      if (!isPriced(session)) continue;
      const attempts = await Promise.all(
        (index === 0 ? [front, other] : [front]).map((by) =>
          act(by, 'POST /session-charges/participants/:participantId', () =>
            svc.charges.post(session.participantId, s(by), ctx()),
          ),
        ),
      );
      const ids = new Set(attempts.map((attempt) => attempt.charge.id));
      if (ids.size !== 1) throw new Error('Concurrent posts raised two charges for one seat.');
      if (attempts.length > 1) count('concurrent charge post');
      await noteCharge(front, session, attempts[0]!.charge);
      count('charge posted after late attendance');
    }

    // ---- the day's sessions ----

    // A therapist's sick day: the clinic cancels everything they had.
    const sickDay = day === nextWeekday(addDays(M1, 9), 2);
    const stopping = seriesOfChild.get(childKeys[8]!.childId) ?? [];
    if (stopping.length > 1 && once('cancel-from', addDays(M1, 14), day)) {
      // A family stops one of its two weekly therapies for good.
      const stopFrom = book.sessions
        .filter(
          (one) => one.seriesId === stopping[1] && one.date >= day && one.status === 'SCHEDULED',
        )
        .sort((a, b) => a.date.localeCompare(b.date))[0];
      if (stopFrom !== undefined) {
        const result = await act(front, 'POST /appointment-series/:id/cancel-from', () =>
          svc.series.cancelFrom(
            stopping[1]!,
            cancelAppointmentSeriesFromRequestSchema.parse({
              fromAppointmentId: stopFrom.appointmentId,
              cancelledBy: 'FAMILY',
              reason: 'خانواده این درمان را متوقف کرد (نمونه)',
            }),
            s(front),
            ctx(),
          ),
        );
        for (const id of result.changedAppointmentIds) {
          const session = book.sessions.find((one) => one.appointmentId === id)!;
          session.status = 'CANCELLED_BY_FAMILY';
        }
        count('series cancelled from a date');
      }
    }

    const todays = book.sessions
      .filter((session) => session.date === day && session.status === 'SCHEDULED')
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

    for (const session of todays) {
      const roll = OUTCOMES[sequence % OUTCOMES.length]!;
      sequence += 1;
      const by = session.startsAt < tehranInstant(day, 13) ? receptionists[0]! : receptionists[1]!;

      if (sickDay && session.therapistId === T2) {
        await cancel(by, session, 'CLINIC', 'درمانگر بیمار بود (نمونه)');
        count('cancelled by clinic');
        continue;
      }
      if (day === calendar.lastHistoryDay && sequence % 4 === 0) {
        count('outcome left unentered');
        continue;
      }
      if (roll < 5) {
        await cancel(by, session, 'FAMILY', 'خانواده اطلاع داد (نمونه)');
        count('cancelled by family');
        continue;
      }
      if (roll < 9) {
        await attend(by, session, 'NO_SHOW');
        await complete(by, session);
        count('no-show');
        continue;
      }
      if (roll < 11) {
        // Marked absent, then the child arrives late: corrected before completion.
        await attend(by, session, 'NO_SHOW');
        await attend(by, session, 'ATTENDED');
        await complete(by, session);
        count('attendance corrected');
        continue;
      }
      if (roll < 14 && day < calendar.lastHistoryDay) {
        await complete(by, session);
        followUps.push(session);
        count('completed with outcome pending');
        continue;
      }
      if (roll >= 90 && roll < 93) {
        // Moved an hour later on the day, where the hour is free.
        const later = addHours(session.startsAt, 1);
        const weekday = clinicWeekday(day);
        const hour = tehranHour(later);
        if (
          therapistHours(session.therapistId).includes(hour) &&
          !taken.has(slotKey(session.therapistId, weekday, hour)) &&
          !(childBusy.get(session.childId) ?? new Set()).has(`${weekday}:${hour}`)
        ) {
          try {
            await act(by, 'PATCH /appointments/:id', () =>
              svc.appointments.move(
                session.appointmentId,
                moveAppointmentRequestSchema.parse({
                  durationMinutes: session.durationMinutes,
                  therapistId: session.therapistId,
                  roomId: session.roomId,
                  startsAt: later,
                  note: null,
                  availabilityOverrideReason: null,
                }),
                s(by),
                ctx(),
              ),
            );
            session.startsAt = later;
            count('appointment moved');
          } catch (error) {
            // A one-off booking already holds the hour: the domain refuses, and
            // the desk leaves the session where it was.
            if (!(error instanceof AppError && error.code.endsWith('_CONFLICT'))) throw error;
            count('move refused by a conflict');
          }
        }
      }

      await attend(by, session, 'ATTENDED');
      if (roll >= 25 && roll < 27) {
        // Two colleagues press "complete" at once: one completion, one charge.
        await Promise.all([
          act(by, 'POST /appointments/:id/complete', () =>
            svc.appointments.complete(session.appointmentId, s(by), ctx()),
          ),
          act(other, 'POST /appointments/:id/complete', () =>
            svc.appointments.complete(session.appointmentId, s(other), ctx()),
          ),
        ]);
        session.status = 'COMPLETED';
        if (isPriced(session)) await noteCharge(by, session);
        count('concurrent completion');
      } else {
        await complete(by, session);
      }
      if (roll >= 20 && roll < 25 && session.chargeId !== null) {
        const again = await act(by, 'POST /session-charges/participants/:participantId', () =>
          svc.charges.post(session.participantId, s(by), ctx()),
        );
        if (again.outcome !== 'ALREADY_POSTED' || again.charge.id !== session.chargeId) {
          throw new Error('A repeated post raised a second charge.');
        }
        count('charge post retried');
      }
      if (session.chargeId !== null) {
        const charge = book.charges.get(session.chargeId)!;
        postedToday.set(charge.familyId, [...(postedToday.get(charge.familyId) ?? []), charge]);
      }
    }

    // ---- the manager's corrections ----

    const todaysCharges = [...postedToday.values()].flat().filter((charge) => !charge.voided);

    if (once('charge-void-absent', addDays(ws, 18), day)) {
      // Marked attended in error: the child was absent. The manager withdraws
      // the charge; the desk then records the absence it should have recorded.
      const charge = todaysCharges.find(
        (one) => one.therapistId === T2 && one.priceMode === 'PAID',
      );
      if (charge === undefined) fired.delete('charge-void-absent');
      else {
        await voidCharge(charge, 'کودک غایب بود و حضور اشتباه ثبت شد (نمونه)');
        const session = book.sessions.find((one) => one.participantId === charge.participantId)!;
        await attend(front, session, 'NO_SHOW');
      }
    }

    if (once('reopen-duration', addDays(M1, 3), day)) {
      // Completed as 45 minutes; it was an hour. The manager withdraws the
      // charge and reopens the session, the desk corrects its length and
      // completes it again, and the hour's price is raised as a NEW charge.
      const charge = todaysCharges.find(
        (one) =>
          one.therapistId === T1 &&
          one.serviceId === OT &&
          one.durationMinutes === 45 &&
          one.adjustments.length === 0,
      );
      if (charge === undefined) fired.delete('reopen-duration');
      else {
        const session = book.sessions.find((one) => one.participantId === charge.participantId)!;
        await voidCharge(charge, 'مدت جلسه اشتباه ثبت شده بود (نمونه)');
        await act(manager, 'POST /appointments/:id/reopen', () =>
          svc.appointments.reopen(
            session.appointmentId,
            'اصلاح مدت جلسه (نمونه)',
            s(manager),
            ctx(),
          ),
        );
        session.status = 'SCHEDULED';
        await act(front, 'PATCH /appointments/:id', () =>
          svc.appointments.move(
            session.appointmentId,
            moveAppointmentRequestSchema.parse({
              durationMinutes: 60,
              therapistId: session.therapistId,
              roomId: session.roomId,
              startsAt: session.startsAt,
              note: null,
              availabilityOverrideReason: null,
            }),
            s(front),
            ctx(),
          ),
        );
        session.durationMinutes = 60;
        await complete(front, session);
        postedToday.set(session.familyId, [
          ...(postedToday.get(session.familyId) ?? []),
          book.charges.get(session.chargeId!)!,
        ]);
        count('completion reopened and corrected');
      }
    }

    // Family 1 has a standing 20% hardship concession, granted at the end of
    // each day. On T1's sessions T1 bears half; on the others the clinic bears it.
    if (day >= addDays(ws, 6)) {
      for (const charge of (postedToday.get(book.families[1]!.id) ?? []).filter(
        (one) => !one.voided && one.priceMode === 'PAID' && one.adjustments.length === 0,
      )) {
        const amount = (charge.expectedAmountToman * 20n) / 100n;
        const portion = charge.therapistId === T1 ? amount / 2n : 0n;
        await concede(charge, amount, portion, 'تخفیف حمایتی ۲۰ درصد (نمونه)');
      }
    }

    if (once('therapist-borne', addDays(ws, 12), day)) {
      const charge = [...book.charges.values()].find(
        (one) =>
          one.therapistId === T1 &&
          !one.voided &&
          one.priceMode === 'PAID' &&
          one.adjustments.length === 0 &&
          one.rating !== null,
      )!;
      await concede(charge, 50_000n, 50_000n, 'درمانگر بخشی از هزینه را بخشید (نمونه)');
    }

    if (once('adjustment-void', addDays(ws, 15), day)) {
      // A concession granted on the wrong session, withdrawn the same day.
      const charge = [...book.charges.values()].find(
        (one) =>
          one.therapistId === T2 &&
          !one.voided &&
          one.priceMode === 'PAID' &&
          one.adjustments.length === 0,
      )!;
      const id = await concede(charge, 70_000n, 0n, 'تخفیف (نمونه)');
      await act(manager, 'POST /session-charges/:chargeId/adjustments/:adjustmentId/void', () =>
        svc.adjustments.void(
          charge.id,
          id,
          'تخفیف روی جلسهٔ اشتباه ثبت شد (نمونه)',
          s(manager),
          ctx(),
        ),
      );
      charge.adjustments.find((adjustment) => adjustment.id === id)!.voided = true;
      audited(id);
      count('concession withdrawn');
    }

    if (once('t3-waiver', addDays(M1, 5), day)) {
      // A full waiver on a session of the therapist who does not share in
      // concessions: the clinic bears all of it and its net goes below zero.
      const charge = [...book.charges.values()].find(
        (one) =>
          one.therapistId === T3 &&
          !one.voided &&
          one.priceMode === 'PAID' &&
          one.adjustments.length === 0 &&
          one.serviceDate >= M1,
      );
      if (charge === undefined) fired.delete('t3-waiver');
      else {
        await concede(
          charge,
          charge.expectedAmountToman,
          0n,
          'بخشش کامل جلسه با تصمیم مدیر (نمونه)',
        );
        count('full waiver');
      }
    }

    // ---- money in ----

    for (const [index, family] of book.families.entries()) {
      if (family === undefined) continue;
      const pattern = index % 6;
      const charges = (postedToday.get(family.id) ?? []).filter((charge) => !charge.voided);

      if (pattern === 0 || pattern === 4) {
        for (const charge of charges) {
          const amount = effective(charge);
          if (amount === 0n) continue;
          if (index === 0 && once('payment-void', addDays(ws, 10), day)) {
            // Ten times the amount, keyed by mistake: voided and re-entered.
            const wrong = await pay(front, family.id, amount * 10n, 'CARD', day);
            await act(manager, 'POST /payments/:id/void', () =>
              svc.payments.void(wrong.id, 'مبلغ اشتباه وارد شد (نمونه)', s(manager), ctx()),
            );
            wrong.voided = true;
            audited(wrong.id);
            count('payment voided');
          }
          // Pattern 4 rounds up to the next hundred thousand, building credit.
          const paidAmount = pattern === 0 ? amount : ((amount + 99_999n) / 100_000n) * 100_000n;
          await pay(front, family.id, paidAmount, pattern === 0 ? 'CARD' : 'CASH', day);
          count(pattern === 0 ? 'payment exact' : 'payment over');
        }
      }

      if (pattern === 1 || (pattern === 3 && index !== 3)) {
        if (once(`arrears-${index}`, addDays(M1, 2), day) && due(family.id) > 0n) {
          await pay(front, family.id, due(family.id), 'TRANSFER', day);
          count('payment exact');
        }
        if (once(`arrears-half-${index}`, addDays(M2, 1), day) && due(family.id) > 0n) {
          await pay(front, family.id, roundDown(due(family.id) / 2n), 'TRANSFER', day);
          count('payment partial');
        }
      }

      if (pattern === 2) {
        if (once(`prepay-${index}`, ws, day)) {
          await pay(front, family.id, 3_000_000n, 'TRANSFER', day);
          count('prepayment');
        }
        if (once(`topup-${index}`, addDays(M1, 5), day)) {
          await pay(manager, family.id, 2_000_000n, 'TRANSFER', day);
          count('prepayment');
        }
      }

      if (pattern === 3 && index === 3) {
        if (once('p3-first', addDays(ws, 3), day)) {
          const owed = due(family.id);
          if (owed > 0n) await pay(front, family.id, roundDown(owed / 2n), 'CASH', day);
          count('payment partial');
          p3.first = await promise(front, family.id, 300_000n, addDays(day, 7));
        }
        if (p3.first !== undefined && once('p3-first-kept', addDays(ws, 10), day)) {
          const payment = await pay(front, family.id, p3.first.amountToman, 'CASH', day);
          await fulfil(front, p3.first, payment);
        }
        // Late in the history, because a promise can only be moved to a date
        // that has not passed yet — today's, not the back-dated business day's.
        if (once('p3-second', addDays(today, -9), day)) {
          p3.second = await promise(front, family.id, 400_000n, addDays(day, 7));
        }
        if (p3.second !== undefined && once('p3-second-moved', addDays(today, -3), day)) {
          const moved = await act(front, 'POST /promises/:id/reschedule', () =>
            svc.promises.reschedule(
              p3.second!.id,
              addDays(day, 7),
              'خانواده زمان بیشتری خواست (نمونه)',
              s(front),
              ctx(),
            ),
          );
          p3.second.status = 'RESCHEDULED';
          audited(p3.second.id);
          const successor: BookPromise = {
            id: moved.successor.id,
            familyId: family.id,
            amountToman: p3.second.amountToman,
            dueOn: addDays(day, 7),
            status: 'OPEN',
          };
          // The successor's creation is recorded on the original's
          // `rescheduled` entry, which names it; it has no entry of its own yet.
          book.promises.push(successor);
          p3.second = successor;
          count('promise rescheduled');
        }
        if (p3.second?.status === 'OPEN' && once('p3-second-kept', calendar.lastHistoryDay, day)) {
          const payment = await pay(front, family.id, p3.second.amountToman, 'CARD', day);
          await fulfil(front, p3.second, payment);
        }
        if (once('p3-third', addDays(M1, 20), day)) {
          p3.third = await promise(front, family.id, 250_000n, addDays(day, 7));
        }
        if (p3.third !== undefined && once('p3-third-cancel', addDays(M1, 22), day)) {
          await act(front, 'POST /promises/:id/cancel', () =>
            svc.promises.cancel(
              p3.third!.id,
              'خانواده قسط‌بندی دیگری خواست (نمونه)',
              s(front),
              ctx(),
            ),
          );
          p3.third.status = 'CANCELLED';
          audited(p3.third.id);
          count('promise cancelled');
        }
        if (once('p3-overdue', addDays(today, -12), day)) {
          await promise(front, family.id, 200_000n, addDays(today, -5));
          count('promise left overdue');
        }
      }

      if (pattern === 5) {
        if (once(`never-${index}-overdue`, addDays(today, -10), day)) {
          await promise(front, family.id, 500_000n, addDays(today, -3));
          count('promise left overdue');
        }
        if (once(`never-${index}-open`, calendar.lastHistoryDay, day)) {
          await promise(front, family.id, 500_000n, addDays(today, 7));
          count('promise open');
        }
      }
    }

    if (!closed && day === closeDay) {
      await closeMonth();
      if (day < calendar.lastHistoryDay) {
        // The corrections land the next working day.
        fired.add('after-close-pending');
      } else {
        await afterClose();
      }
    } else if (fired.has('after-close-pending') && !fired.has('after-close')) {
      fired.add('after-close');
      await afterClose();
    }
  }

  if (!closed) {
    await closeMonth();
    await afterClose();
  }

  // The month-end position, exported after every correction.
  const accounts = await act(manager, 'GET /reports/family-accounts/export', () =>
    svc.exports.familyAccounts(familyAccountReportExportQuerySchema.parse({}), s(manager), ctx()),
  );
  book.exports.push({
    label: 'family-accounts',
    csv: accounts.csv,
    rowCount: accounts.rowCount,
    range: null,
  });

  return { book };

  // ---- local helpers that need the closure ----

  async function fulfil(by: Person, record: BookPromise, payment: BookPayment) {
    await act(by, 'POST /promises/:id/fulfill', () =>
      svc.promises.fulfill(record.id, payment.id, s(by), ctx()),
    );
    record.status = 'FULFILLED';
    audited(record.id);
    count('promise fulfilled');
  }

  async function submitEnquiry(
    n: number,
    serviceSlug: string | null,
    age: number,
    sex: 'FEMALE' | 'MALE',
    ip: number,
    contactMobile = mobile(n),
    recordIt = true,
  ) {
    await act(visitor, 'POST /public/requests', () =>
      svc.publicRequests.submit(
        publicRequestSubmissionSchema.parse({
          contactName: 'والد نمونه',
          contactMobile,
          serviceSlug,
          childName: null,
          childAgeYears: age,
          childSex: sex,
          preferredContactTime: 'MORNING',
          note: null,
          consent: true,
          consentVersion:
            PUBLIC_REQUEST_CONSENT_VERSIONS[PUBLIC_REQUEST_CONSENT_VERSIONS.length - 1],
        }),
        { requestId: uuidv7(), clientIp: TEST_NET(ip), userAgent: null, session: null },
      ),
    );
    if (recordIt) {
      book.websiteRequests.push({ contactMobile, id: null, status: 'NEW', linkedFamilyId: null });
    }
  }

  async function inboxRequest(key: number | string): Promise<BookWebsiteRequest> {
    const contactMobile = typeof key === 'number' ? mobile(key) : key;
    const record = book.websiteRequests.find((one) => one.contactMobile === contactMobile)!;
    if (record.id === null) {
      const inbox = await act(receptionists[0]!, 'GET /website-requests', () =>
        svc.websiteRequests.inbox(websiteRequestInboxQuerySchema.parse({ pageSize: 100 })),
      );
      const found = inbox.requests.find(
        (one) => !one.contentPurged && one.contactMobile === contactMobile,
      );
      if (found === undefined) throw new Error('A submitted enquiry is not in the inbox.');
      record.id = found.id;
    }
    return record;
  }

  async function setRequestStatus(
    by: Person,
    record: BookWebsiteRequest,
    status: 'CONTACTED' | 'FOLLOW_UP_NEEDED' | 'CLOSED',
  ) {
    await act(by, 'PATCH /website-requests/:id/status', () =>
      svc.websiteRequests.changeStatus(record.id!, { status }, s(by), ctx()),
    );
    record.status = status;
    audited(record.id!);
  }

  async function linkRequest(by: Person, record: BookWebsiteRequest, familyId: string) {
    await act(by, 'POST /website-requests/:id/link', () =>
      svc.websiteRequests.link(record.id!, { familyId }, s(by), ctx()),
    );
    record.status = 'CONVERTED_TO_FAMILY';
    record.linkedFamilyId = familyId;
    audited(record.id!);
  }

  async function bookSingle(
    by: Person,
    plan: { childId: string; therapistId: string; serviceId: string; minutes: number; day: string },
  ) {
    for (const hour of therapistHours(plan.therapistId)) {
      if (taken.has(slotKey(plan.therapistId, clinicWeekday(plan.day), hour))) continue;
      try {
        return await act(by, 'POST /appointments', () =>
          svc.appointments.create(
            createAppointmentRequestSchema.parse({
              serviceId: plan.serviceId,
              durationMinutes: plan.minutes,
              therapistId: plan.therapistId,
              roomId: roomOf(plan.therapistId),
              childId: plan.childId,
              startsAt: tehranInstant(plan.day, hour),
              note: null,
              availabilityOverrideReason: null,
            }),
            s(by),
            ctx(),
          ),
        );
      } catch (error) {
        if (error instanceof AppError && error.code.startsWith('APPOINTMENT_')) continue;
        throw error;
      }
    }
    throw new Error('No free hour for a single booking.');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Person = { role: SimRole; session: ResolvedSession | null; label: string };

async function assertEmptyClinic(prisma: PrismaService): Promise<void> {
  const rows = await prisma.$queryRaw<{ families: bigint; services: bigint }[]>`
    SELECT (SELECT count(*) FROM family) AS families, (SELECT count(*) FROM service) AS services
  `;
  const row = rows[0];
  if (row === undefined || row.families > 0n || row.services > 0n) {
    throw new Error(
      'Refusing to simulate: this clinic already has families or services. The practice clinic ' +
        'must start from an empty database so every reconciled total is its own.',
    );
  }
}

function duplicateDraft(
  error: unknown,
  code: string,
): { draftToken: string; candidateIds: string[] } {
  if (!(error instanceof AppError) || error.code !== code) throw error;
  const details = error.details as {
    draftToken: string;
    candidates: { familyId: string; childId: string | null; blocking: boolean }[];
  };
  return {
    draftToken: details.draftToken,
    candidateIds: [
      ...new Set(
        details.candidates
          .filter((candidate) => candidate.blocking)
          .map((candidate) => candidate.childId ?? candidate.familyId),
      ),
    ],
  };
}

const JALALI = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

/** The Jalali year, month and day of a clinic date, from the platform's calendar data. */
export function jalali(day: string): { year: number; month: number; day: number } {
  const parts = JALALI.formatToParts(new Date(`${day}T00:00:00Z`));
  const part = (type: string) => Number.parseInt(parts.find((one) => one.type === type)!.value, 10);
  return { year: part('year'), month: part('month'), day: part('day') };
}

const jalaliMonthStart = (day: string) => addDays(day, -(jalali(day).day - 1));
const jalaliLabel = (day: string) => {
  const { year, month } = jalali(day);
  return `${year}-${String(month).padStart(2, '0')}`;
};

export function buildCalendar(today: string): SimulationCalendar {
  const currentMonthStart = jalaliMonthStart(today);
  const closedTo = addDays(currentMonthStart, -1);
  const closedFrom = jalaliMonthStart(closedTo);
  const windowStart = addDays(closedFrom, -21);
  const lastHistoryDay = addDays(today, -1);

  const months: SimulationCalendar['months'] = [];
  for (let from = windowStart; from <= lastHistoryDay;) {
    const next = addDays(jalaliMonthStart(addDays(jalaliMonthStart(from), 32)), 0);
    const to = addDays(next, -1) < lastHistoryDay ? addDays(next, -1) : lastHistoryDay;
    months.push({ from, to, label: jalaliLabel(from) });
    from = addDays(to, 1);
  }

  return {
    today,
    windowStart,
    lastHistoryDay,
    bookedUntil: addDays(today, 6),
    closedMonth: { from: closedFrom, to: closedTo, label: jalaliLabel(closedFrom) },
    months,
  };
}

const dayIndex = (from: string, day: string) =>
  Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The clinic day of an instant: Tehran is UTC+03:30 with no daylight saving. */
export const tehranDate = (instant: string) =>
  new Date(Date.parse(instant) + 210 * 60_000).toISOString().slice(0, 10);

const tehranHour = (instant: string) => new Date(Date.parse(instant) + 210 * 60_000).getUTCHours();

const addHours = (instant: string, hours: number) =>
  new Date(Date.parse(instant) + hours * 3_600_000).toISOString();

/**
 * What happens to the n-th session the desk processes, as a 0–99 roll read by
 * the branches of the day loop: mostly attended, and every special case at
 * least once every twenty sessions. A fixed rotation rather than a hash of an
 * id, because ids are time-ordered and random and the practice clinic must
 * contain every scenario on every run.
 *
 *   50 attended · 0 family cancels · 5 no-show · 9 absent then arrived late ·
 *   11 completed with the outcome pending · 20 charge re-posted ·
 *   25 completed twice at once · 90 moved an hour later
 */
const OUTCOMES: readonly number[] = [
  50, 50, 0, 50, 5, 50, 20, 50, 9, 50, 11, 50, 50, 25, 50, 5, 90, 50, 0, 50,
];

const roundDown = (amount: bigint) => (amount / 10_000n) * 10_000n;

function firstTakenSlot(
  taken: Set<string>,
  therapistId: string,
  hours: (therapistId: string) => readonly number[],
): { weekday: number; hour: number } | undefined {
  for (const weekday of [0, 1, 2, 3, 4]) {
    for (const hour of hours(therapistId)) {
      if (taken.has(`${therapistId}:${weekday}:${hour}`)) return { weekday, hour };
    }
  }
  return undefined;
}
