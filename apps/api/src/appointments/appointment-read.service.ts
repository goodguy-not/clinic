import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AppointmentDayQuery,
  AppointmentDayResponse,
  AppointmentDaySummary,
  AppointmentTariffSuggestion,
  AppointmentView,
  TariffPriceMode,
} from '@clinic/contracts';
import { resolveTariffSql } from '../catalog/tariffs/tariff-resolution';
import { AppError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { toAppointment, toParticipant, type AppointmentRow } from './booking-support';

/**
 * The operational read model: one clinic day, and one appointment ready to
 * render.
 *
 * A SEPARATE CLASS FROM THE ONE THAT WRITES, and the separation is the point.
 * `AppointmentsService` books, moves, completes and cancels, and it must never
 * read a tariff — a price that entered a booking transaction would be one step
 * from being stored in it, and pricing a session is Milestone 5's. This class
 * reads a tariff and holds no transaction, takes no lock and writes no row, not
 * even an audit row. Neither can become the other by accident.
 *
 * THE TARIFF IS A SUGGESTION AND IS PERSISTED NOWHERE. It is resolved on every
 * read from the price list as it stands, against the appointment's own clinic
 * date, therapist, service and duration, by the same SQL
 * `/catalog/tariff-resolution` answers with. It exists so a receptionist can see
 * what a session will cost while they arrange it; what the family is actually
 * charged is decided when the session is priced, from the tariff in force then.
 * A MISSING TARIFF IS SHOWN, NOT RAISED: PROJECT_SPEC.md 5 requires it to be
 * visible, and a day view that failed because one service has no price would
 * take the whole diary down with it.
 *
 * ONE STATEMENT FOR THE DAY, ONE FOR THE SEATS. The alternative — a query per
 * appointment for its price, its child, its room — is an N+1 on the screen the
 * clinic keeps open all day. Both read from the same snapshot as far as a
 * read-committed pair of statements can, which is enough for a view: nothing is
 * decided here, so nothing depends on the two being one instant.
 */

/** One appointment row, joined to the names an interface prints. */
type DayRow = AppointmentRow & {
  service_name: string;
  therapist_name: string;
  room_name: string;
  tariff_id: string | null;
  tariff_price_mode: TariffPriceMode | null;
  tariff_price_toman: bigint | null;
  outcome_unresolved: boolean;
};

/**
 * The connection a read runs on: this module's own, or a caller's transaction.
 *
 * Milestone 7's dashboard states the day's appointment counts and its money in
 * one response, and derives them from ONE `REPEATABLE READ` snapshot. Passing
 * its transaction in is what keeps that true — a helper that reached for
 * `this.prisma` would open a second connection with a second snapshot and
 * silently undo it. The parameter is optional and defaults to this module's own
 * client, so `GET /appointment-day` is unchanged in every respect.
 */
export type AppointmentReadClient = PrismaService | Prisma.TransactionClient;

type SeatRow = {
  id: string;
  appointment_id: string;
  child_id: string;
  attendance: string;
  attendance_recorded_at: Date | null;
  family_id: string;
  first_name: string;
  last_name: string;
  file_number: string;
};

/**
 * Everything the read model selects, in one place.
 *
 * `outcome_unresolved` is computed in SQL against the database's own clock, not
 * in Node and not in a browser: "the session is over and nobody said what
 * happened" is the receptionist dashboard's outstanding-work list
 * (PROJECT_SPEC.md 10), and two screens must not disagree about which sessions
 * are on it. A cancelled appointment is never on it — nothing happened, so
 * there is no outcome to record — and a session still in progress is not either.
 */
const DAY_COLUMNS = Prisma.sql`
  a.id, a.service_id, a.duration_minutes, a.therapist_id, a.room_id,
  a.starts_at, a.ends_at, a.status::text AS status, a.series_id, a.note,
  a.completed_at, a.cancelled_at, a.cancellation_reason,
  a.availability_override_reason, a.created_at,
  s.name AS service_name,
  t.full_name AS therapist_name,
  r.name AS room_name,
  tariff.id AS tariff_id,
  tariff.price_mode::text AS tariff_price_mode,
  tariff.price_toman AS tariff_price_toman,
  (
    a.status IN ('SCHEDULED', 'COMPLETED')
    AND a.ends_at <= statement_timestamp()
    AND EXISTS (
      SELECT 1 FROM appointment_participant ap
      WHERE ap.appointment_id = a.id AND ap.attendance = 'PENDING'
    )
  ) AS outcome_unresolved
`;

/**
 * The joins every read shares.
 *
 * The three catalog joins are inner: an appointment cannot exist without its
 * service, therapist and room — three foreign keys with `ON DELETE RESTRICT`
 * say so — and a LEFT JOIN would quietly hide a broken row instead of failing
 * loudly.
 *
 * The tariff is a LATERAL, so the price list is consulted with each
 * appointment's own scope and date, and the day costs one statement rather than
 * one per row. `LEFT JOIN … ON TRUE` is what makes an unpriced session a row
 * with nulls instead of a row that disappears — a session the clinic cannot
 * price is exactly the one a receptionist must be shown.
 */
const DAY_SOURCE = Prisma.sql`
  FROM appointment a
  JOIN service s ON s.id = a.service_id
  JOIN therapist t ON t.id = a.therapist_id
  JOIN room r ON r.id = a.room_id
  LEFT JOIN LATERAL (
    ${resolveTariffSql(Prisma.sql`id, price_mode, price_toman`, {
      serviceId: Prisma.sql`a.service_id`,
      durationMinutes: Prisma.sql`a.duration_minutes`,
      therapistId: Prisma.sql`a.therapist_id`,
      serviceDate: Prisma.sql`clinic_date(a.starts_at)`,
    })}
  ) tariff ON TRUE
`;

@Injectable()
export class AppointmentReadService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One clinic day, whole and in start order.
   *
   * THE DAY IS AN INSTANT RANGE, not `clinic_date(starts_at) = $1`. The two ask
   * the same question, but the range is a half-open comparison against a plain
   * column and uses `appointment_starts_at_idx`, while the function form is
   * applied per row and reads every appointment the clinic has ever booked.
   * `clinic_day_start` keeps `Asia/Tehran` written once, in the database, beside
   * `clinic_date` and `clinic_clock_time`.
   *
   * EVERY STATUS IS RETURNED, including both cancellations. The clinic has to
   * see the hole in the diary and who cancelled it; a day view that quietly
   * dropped them would make a cancelled session look like one that was never
   * booked (PROJECT_SPEC.md 14).
   *
   * The order is the order a day is read: by start, then by room so a reader can
   * follow one room down the page, then by id so two appointments that begin in
   * the same room-less tie never swap places between two identical requests.
   */
  async day(
    query: AppointmentDayQuery,
    client: AppointmentReadClient = this.prisma,
  ): Promise<AppointmentDayResponse> {
    const filters: Prisma.Sql[] = [];

    if (query.therapistId !== undefined) {
      filters.push(Prisma.sql`AND a.therapist_id = ${query.therapistId}::uuid`);
    }
    if (query.roomId !== undefined) {
      filters.push(Prisma.sql`AND a.room_id = ${query.roomId}::uuid`);
    }

    const narrowing = filters.length === 0 ? Prisma.empty : Prisma.join(filters, ' ');

    const rows = await client.$queryRaw<DayRow[]>`
      SELECT ${DAY_COLUMNS}
      ${DAY_SOURCE}
      WHERE a.starts_at >= clinic_day_start(${query.date}::date)
        AND a.starts_at < clinic_day_start((${query.date}::date + 1))
        ${narrowing}
      ORDER BY a.starts_at ASC, r.name ASC, a.id ASC
    `;

    const appointments = await this.withSeats(rows, client);

    return { date: query.date, summary: summarize(appointments), appointments };
  }

  /**
   * One appointment, in the same shape a day row has.
   *
   * The same object the day view renders, so a detail screen and a row in the
   * diary cannot show two different readings of one appointment — including the
   * price suggestion, which a booking screen needs while it is being arranged.
   *
   * `GET /appointments/:id` still returns the plain booking and its seats. That
   * one is what every write returns and what a caller re-reads to check a
   * transition; this one is what a screen renders. They are separate because a
   * write must not carry a price, and a screen must.
   */
  async view(id: string): Promise<AppointmentView> {
    const rows = await this.prisma.$queryRaw<DayRow[]>`
      SELECT ${DAY_COLUMNS}
      ${DAY_SOURCE}
      WHERE a.id = ${id}::uuid
    `;

    if (rows.length === 0) throw new AppError('APPOINTMENT_NOT_FOUND');

    const views = await this.withSeats(rows, this.prisma);
    const view = views[0];
    // Unreachable: `withSeats` maps one view per row and there is exactly one.
    if (view === undefined) throw new AppError('APPOINTMENT_NOT_FOUND');
    return view;
  }

  /** The seats for a set of appointments, in one statement, with their children. */
  private async withSeats(
    rows: readonly DayRow[],
    client: AppointmentReadClient,
  ): Promise<AppointmentView[]> {
    if (rows.length === 0) return [];

    const seats = await client.$queryRaw<SeatRow[]>`
      SELECT ap.id, ap.appointment_id, ap.child_id,
             ap.attendance::text AS attendance, ap.attendance_recorded_at,
             c.family_id, c.first_name, c.last_name, c.file_number
      FROM appointment_participant ap
      JOIN child c ON c.id = ap.child_id
      WHERE ap.appointment_id = ANY(${rows.map((row) => row.id)}::uuid[])
      ORDER BY ap.id ASC
    `;

    return rows.map((row) => toView(row, seats));
  }
}

function toView(row: DayRow, seats: readonly SeatRow[]): AppointmentView {
  return {
    appointment: toAppointment(row),
    participants: seats
      .filter((seat) => seat.appointment_id === row.id)
      .map((seat) => ({
        participant: toParticipant(seat),
        child: {
          id: seat.child_id,
          familyId: seat.family_id,
          firstName: seat.first_name,
          lastName: seat.last_name,
          fileNumber: seat.file_number,
        },
      })),
    service: { id: row.service_id, name: row.service_name },
    therapist: { id: row.therapist_id, fullName: row.therapist_name },
    room: { id: row.room_id, name: row.room_name },
    tariffSuggestion: toSuggestion(row),
    outcomeUnresolved: row.outcome_unresolved,
  };
}

/**
 * The price list's answer, or the visible absence of one.
 *
 * `price_toman` is `bigint` in PostgreSQL and arrives as a JavaScript `BigInt`;
 * it is carried as a decimal string, as every amount in this system is, because
 * a Toman value above 2^53 is representable in the database and not in a JSON
 * number.
 */
function toSuggestion(row: DayRow): AppointmentTariffSuggestion {
  if (row.tariff_id === null || row.tariff_price_mode === null || row.tariff_price_toman === null) {
    return { status: 'MISSING' };
  }

  return {
    status: 'RESOLVED',
    tariffId: row.tariff_id,
    priceMode: row.tariff_price_mode,
    priceToman: row.tariff_price_toman.toString(),
  };
}

/**
 * The dashboard's counts, taken from exactly the rows being returned.
 *
 * Counted here rather than by a second set of aggregate queries: a `COUNT(*)`
 * over the same predicate is a second statement that can see a different
 * snapshot, and a badge that disagrees with the list under it is worse than no
 * badge. `noShows` counts APPOINTMENTS with at least one no-show seat, which for
 * an individual appointment — exactly one participant — is the same number as
 * counting the seats, and stays meaningful if group bookings ever arrive.
 */
function summarize(appointments: readonly AppointmentView[]): AppointmentDaySummary {
  const count = (predicate: (view: AppointmentView) => boolean): number =>
    appointments.filter(predicate).length;

  return {
    total: appointments.length,
    scheduled: count((view) => view.appointment.status === 'SCHEDULED'),
    completed: count((view) => view.appointment.status === 'COMPLETED'),
    cancelled: count((view) => view.appointment.status.startsWith('CANCELLED_')),
    unresolvedOutcomes: count((view) => view.outcomeUnresolved),
    noShows: count((view) =>
      view.participants.some((seat) => seat.participant.attendance === 'NO_SHOW'),
    ),
  };
}
