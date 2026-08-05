import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CatalogStatus,
  CreateTherapistRequest,
  Therapist,
  UpdateTherapistRequest,
} from '@clinic/contracts';
import { AuditService } from '../../audit/audit.service';
import { AppError } from '../../common/app-error';
import type { RequestContext, ResolvedSession } from '../../common/request-context';
import { uuidv7 } from '../../common/uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { actorContext, canonicalText } from '../catalog-support';

/**
 * Therapists as clinic reference data, and the services each supports.
 *
 * Not accounts. There is no username, password, session or login anywhere in
 * this module: therapist access is a separately approved decision that has not
 * been made (PROJECT_SPEC.md 4). `createdBy` names the manager who entered the
 * record, which is a different fact.
 *
 * There is no settlement percentage either. That rule is effective-dated and
 * must be snapshotted onto each completed session, so a column here would be
 * the wrong shape and would invite writing one.
 *
 * Names are deliberately not unique. Two therapists may genuinely share a full
 * name and a specialty, and refusing the second would be refusing a real
 * person. There is no duplicate-warning workflow either — that is an approved
 * feature for families, not for this milestone.
 *
 * A supported-service association is not revoked when a service is deactivated.
 * The row is current configuration and stays as recorded; dropping it silently
 * would lose a decision somebody made, and reactivating the service would not
 * bring it back.
 */

type TherapistRow = {
  id: string;
  full_name: string;
  specialty: string;
  status: CatalogStatus;
  deactivated_at: Date | null;
  created_at: Date;
  supported_service_ids: string[];
};

/**
 * Ordered by service name so the stored set has one deterministic reading.
 * Ordering by id would be stable but arbitrary, and the interface shows names.
 */
const THERAPIST_COLUMNS = Prisma.sql`
  t.id,
  t.full_name,
  t.specialty,
  t.status::text AS status,
  t.deactivated_at,
  t.created_at,
  COALESCE(
    (
      SELECT array_agg(ts.service_id ORDER BY s.name)
      FROM therapist_service ts
      JOIN service s ON s.id = ts.service_id
      WHERE ts.therapist_id = t.id
    ),
    ARRAY[]::uuid[]
  ) AS supported_service_ids
`;

@Injectable()
export class TherapistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<Therapist[]> {
    const rows = await this.prisma.$queryRaw<TherapistRow[]>`
      SELECT ${THERAPIST_COLUMNS} FROM therapist t ORDER BY t.full_name ASC, t.created_at ASC
    `;

    return rows.map(toTherapist);
  }

  async get(id: string): Promise<Therapist> {
    const rows = await this.prisma.$queryRaw<TherapistRow[]>`
      SELECT ${THERAPIST_COLUMNS} FROM therapist t WHERE t.id = ${id}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('THERAPIST_NOT_FOUND');
    return toTherapist(row);
  }

  async create(
    input: CreateTherapistRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<Therapist> {
    const id = uuidv7();
    const fullName = canonicalText(input.fullName);
    const specialty = canonicalText(input.specialty);
    const serviceIds = unique(input.supportedServiceIds);

    const created = await this.prisma.$transaction(async (tx) => {
      await this.assertServicesExist(tx, serviceIds);

      await tx.$executeRaw`
        INSERT INTO therapist (id, full_name, specialty, status, created_at, created_by_user_id)
        VALUES (
          ${id}::uuid, ${fullName}, ${specialty}, 'ACTIVE'::catalog_status,
          transaction_timestamp(), ${actor.userId}::uuid
        )
      `;

      await this.insertSupportedServices(tx, id, serviceIds);

      const row = await this.readForUpdate(tx, id);

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'therapist.created',
        entityType: 'therapist',
        entityId: id,
        after: {
          fullName: row.full_name,
          specialty: row.specialty,
          status: row.status,
          supportedServiceIds: row.supported_service_ids,
        },
      });

      return row;
    });

    return toTherapist(created);
  }

  async update(
    id: string,
    input: UpdateTherapistRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<Therapist> {
    const fullName = canonicalText(input.fullName);
    const specialty = canonicalText(input.specialty);
    const serviceIds = unique(input.supportedServiceIds);

    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, id);
      await this.assertServicesExist(tx, serviceIds);

      await tx.$executeRaw`
        UPDATE therapist
        SET full_name = ${fullName}, specialty = ${specialty}
        WHERE id = ${id}::uuid
      `;

      // Replaced wholesale rather than diffed: these rows carry no history of
      // their own — the change is recorded in `audit_log` under
      // `therapist.updated` — and nothing references them, so there is no
      // RESTRICT to work around. Both statements are in this transaction, so a
      // rejected service id leaves the previous set intact rather than a
      // half-applied one.
      await tx.$executeRaw`DELETE FROM therapist_service WHERE therapist_id = ${id}::uuid`;
      await this.insertSupportedServices(tx, id, serviceIds);

      const after = await this.readForUpdate(tx, id);

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'therapist.updated',
        entityType: 'therapist',
        entityId: id,
        before: {
          fullName: before.full_name,
          specialty: before.specialty,
          supportedServiceIds: before.supported_service_ids,
        },
        after: {
          fullName: after.full_name,
          specialty: after.specialty,
          supportedServiceIds: after.supported_service_ids,
        },
      });

      return after;
    });

    return toTherapist(updated);
  }

  async changeStatus(
    id: string,
    status: CatalogStatus,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<Therapist> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, id);

      // Already in the requested state: return it unchanged rather than writing
      // an audit row whose before and after are identical.
      if (before.status === status) return before;

      // `transaction_timestamp()` rather than a value from Node: it is constant
      // for the whole transaction, so this timestamp and the `occurred_at` of
      // the audit row below are provably the same instant.
      if (status === 'INACTIVE') {
        await tx.$executeRaw`
          UPDATE therapist
          SET status = 'INACTIVE'::catalog_status, deactivated_at = transaction_timestamp()
          WHERE id = ${id}::uuid
        `;
      } else {
        await tx.$executeRaw`
          UPDATE therapist
          SET status = 'ACTIVE'::catalog_status, deactivated_at = NULL
          WHERE id = ${id}::uuid
        `;
      }

      const after = await this.readForUpdate(tx, id);

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'therapist.status_changed',
        entityType: 'therapist',
        entityId: id,
        before: { status: before.status },
        after: { status: after.status },
      });

      return after;
    });

    return toTherapist(updated);
  }

  /**
   * Checked in the application rather than left to the foreign key, so an
   * unknown service id produces `SERVICE_NOT_FOUND` — the same code the room
   * slice returns for the same mistake — instead of a constraint failure the
   * interface cannot explain. The foreign key is still there and still
   * authoritative.
   *
   * Status is deliberately not filtered: associating a therapist with an
   * inactive service is not forbidden by any approved rule, and inventing that
   * rule here would silently reject configuration a manager asked for.
   */
  private async assertServicesExist(
    tx: Prisma.TransactionClient,
    serviceIds: string[],
  ): Promise<void> {
    if (serviceIds.length === 0) return;

    const found = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM service
      WHERE id IN (${Prisma.join(serviceIds.map((id) => Prisma.sql`${id}::uuid`))})
    `;

    if (found.length !== serviceIds.length) throw new AppError('SERVICE_NOT_FOUND');
  }

  private async insertSupportedServices(
    tx: Prisma.TransactionClient,
    therapistId: string,
    serviceIds: string[],
  ): Promise<void> {
    for (const serviceId of serviceIds) {
      await tx.$executeRaw`
        INSERT INTO therapist_service (therapist_id, service_id)
        VALUES (${therapistId}::uuid, ${serviceId}::uuid)
      `;
    }
  }

  /**
   * Locks the row for the rest of the transaction, so two concurrent updates
   * cannot each replace the association set against a stale reading.
   */
  private async lock(tx: Prisma.TransactionClient, id: string): Promise<TherapistRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM therapist WHERE id = ${id}::uuid FOR UPDATE
    `;

    if (locked[0] === undefined) throw new AppError('THERAPIST_NOT_FOUND');

    return this.readForUpdate(tx, id);
  }

  private async readForUpdate(tx: Prisma.TransactionClient, id: string): Promise<TherapistRow> {
    const rows = await tx.$queryRaw<TherapistRow[]>`
      SELECT ${THERAPIST_COLUMNS} FROM therapist t WHERE t.id = ${id}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('THERAPIST_NOT_FOUND');
    return row;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function toTherapist(row: TherapistRow): Therapist {
  return {
    id: row.id,
    fullName: row.full_name,
    specialty: row.specialty,
    status: row.status,
    deactivatedAt: row.deactivated_at === null ? null : row.deactivated_at.toISOString(),
    supportedServiceIds: row.supported_service_ids,
    createdAt: row.created_at.toISOString(),
  };
}
