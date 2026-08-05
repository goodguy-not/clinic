import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CatalogStatus, CreateRoomRequest, Room, UpdateRoomRequest } from '@clinic/contracts';
import { AuditService } from '../../audit/audit.service';
import { AppError } from '../../common/app-error';
import { isUniqueViolation } from '../../common/pg-error';
import type { RequestContext, ResolvedSession } from '../../common/request-context';
import { uuidv7 } from '../../common/uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { actorContext, canonicalText } from '../catalog-support';

/**
 * Treatment rooms, and the services each may be used for.
 *
 * `allowedServiceIds` is an allow-list where **empty means unrestricted** — the
 * common case, and the one that needs no data entry. That asymmetry is the
 * reason the web form asks the question explicitly rather than letting an
 * untouched multi-select mean "any service": the two are indistinguishable in
 * the data, so the interface has to be the thing that distinguishes them.
 *
 * A restriction is not revoked when a service is deactivated. The row is
 * current configuration and stays as recorded; silently dropping it would lose
 * a decision somebody made, and reactivating the service would not bring it
 * back.
 */

type RoomRow = {
  id: string;
  name: string;
  status: CatalogStatus;
  deactivated_at: Date | null;
  created_at: Date;
  allowed_service_ids: string[];
};

const ROOM_COLUMNS = Prisma.sql`
  r.id,
  r.name,
  r.status::text AS status,
  r.deactivated_at,
  r.created_at,
  COALESCE(
    (
      SELECT array_agg(rs.service_id ORDER BY s.name)
      FROM room_service rs
      JOIN service s ON s.id = rs.service_id
      WHERE rs.room_id = r.id
    ),
    ARRAY[]::uuid[]
  ) AS allowed_service_ids
`;

@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<Room[]> {
    const rows = await this.prisma.$queryRaw<RoomRow[]>`
      SELECT ${ROOM_COLUMNS} FROM room r ORDER BY r.name ASC
    `;

    return rows.map(toRoom);
  }

  async get(id: string): Promise<Room> {
    const rows = await this.prisma.$queryRaw<RoomRow[]>`
      SELECT ${ROOM_COLUMNS} FROM room r WHERE r.id = ${id}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('ROOM_NOT_FOUND');
    return toRoom(row);
  }

  async create(
    input: CreateRoomRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<Room> {
    const id = uuidv7();
    const name = canonicalText(input.name);
    const serviceIds = unique(input.allowedServiceIds);

    const created = await this.prisma.$transaction(async (tx) => {
      await this.assertServicesExist(tx, serviceIds);

      try {
        await tx.$executeRaw`
          INSERT INTO room (id, name, status, created_at, created_by_user_id)
          VALUES (
            ${id}::uuid, ${name}, 'ACTIVE'::catalog_status,
            transaction_timestamp(), ${actor.userId}::uuid
          )
        `;
      } catch (error) {
        if (isUniqueViolation(error)) throw new AppError('ROOM_NAME_TAKEN');
        throw error;
      }

      await this.insertRestrictions(tx, id, serviceIds);

      const row = await this.readForUpdate(tx, id);

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'room.created',
        entityType: 'room',
        entityId: id,
        after: {
          name: row.name,
          status: row.status,
          allowedServiceIds: row.allowed_service_ids,
          unrestricted: row.allowed_service_ids.length === 0,
        },
      });

      return row;
    });

    return toRoom(created);
  }

  async update(
    id: string,
    input: UpdateRoomRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<Room> {
    const name = canonicalText(input.name);
    const serviceIds = unique(input.allowedServiceIds);

    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, id);
      await this.assertServicesExist(tx, serviceIds);

      try {
        await tx.$executeRaw`UPDATE room SET name = ${name} WHERE id = ${id}::uuid`;
      } catch (error) {
        if (isUniqueViolation(error)) throw new AppError('ROOM_NAME_TAKEN');
        throw error;
      }

      // Replaced wholesale rather than diffed: these rows carry no history of
      // their own — the change is recorded in `audit_log` under `room.updated`
      // — and nothing references them, so there is no RESTRICT to work around.
      // Both statements are in this transaction, so a failure leaves the old
      // set intact rather than a half-applied one.
      await tx.$executeRaw`DELETE FROM room_service WHERE room_id = ${id}::uuid`;
      await this.insertRestrictions(tx, id, serviceIds);

      const after = await this.readForUpdate(tx, id);

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'room.updated',
        entityType: 'room',
        entityId: id,
        before: {
          name: before.name,
          allowedServiceIds: before.allowed_service_ids,
          unrestricted: before.allowed_service_ids.length === 0,
        },
        after: {
          name: after.name,
          allowedServiceIds: after.allowed_service_ids,
          unrestricted: after.allowed_service_ids.length === 0,
        },
      });

      return after;
    });

    return toRoom(updated);
  }

  async changeStatus(
    id: string,
    status: CatalogStatus,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<Room> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, id);

      if (before.status === status) return before;

      if (status === 'INACTIVE') {
        await tx.$executeRaw`
          UPDATE room
          SET status = 'INACTIVE'::catalog_status, deactivated_at = transaction_timestamp()
          WHERE id = ${id}::uuid
        `;
      } else {
        await tx.$executeRaw`
          UPDATE room
          SET status = 'ACTIVE'::catalog_status, deactivated_at = NULL
          WHERE id = ${id}::uuid
        `;
      }

      const after = await this.readForUpdate(tx, id);

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'room.status_changed',
        entityType: 'room',
        entityId: id,
        before: { status: before.status },
        after: { status: after.status },
      });

      return after;
    });

    return toRoom(updated);
  }

  /**
   * Checked in the application rather than left to the foreign key, so an
   * unknown service id produces `SERVICE_NOT_FOUND` instead of a generic
   * constraint failure the interface cannot explain. The foreign key is still
   * there and still authoritative.
   */
  private async assertServicesExist(
    tx: Prisma.TransactionClient,
    serviceIds: string[],
  ): Promise<void> {
    if (serviceIds.length === 0) return;

    const found = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM service WHERE id IN (${Prisma.join(serviceIds.map((id) => Prisma.sql`${id}::uuid`))})
    `;

    if (found.length !== serviceIds.length) throw new AppError('SERVICE_NOT_FOUND');
  }

  private async insertRestrictions(
    tx: Prisma.TransactionClient,
    roomId: string,
    serviceIds: string[],
  ): Promise<void> {
    for (const serviceId of serviceIds) {
      await tx.$executeRaw`
        INSERT INTO room_service (room_id, service_id)
        VALUES (${roomId}::uuid, ${serviceId}::uuid)
      `;
    }
  }

  private async lock(tx: Prisma.TransactionClient, id: string): Promise<RoomRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM room WHERE id = ${id}::uuid FOR UPDATE
    `;

    if (locked[0] === undefined) throw new AppError('ROOM_NOT_FOUND');

    return this.readForUpdate(tx, id);
  }

  private async readForUpdate(tx: Prisma.TransactionClient, id: string): Promise<RoomRow> {
    const rows = await tx.$queryRaw<RoomRow[]>`
      SELECT ${ROOM_COLUMNS} FROM room r WHERE r.id = ${id}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('ROOM_NOT_FOUND');
    return row;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function toRoom(row: RoomRow): Room {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    deactivatedAt: row.deactivated_at === null ? null : row.deactivated_at.toISOString(),
    allowedServiceIds: row.allowed_service_ids,
    createdAt: row.created_at.toISOString(),
  };
}
