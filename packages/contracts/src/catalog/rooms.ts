import { z } from 'zod';
import { catalogNameSchema, catalogStatusSchema } from './common';

/**
 * A treatment room.
 *
 * `allowedServiceIds` is an allow-list and an empty array means unrestricted —
 * the common case, and the one that needs no data entry. A room restricted to
 * services that were later deactivated keeps its restriction; nothing here
 * rewrites it.
 */
export const roomSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  status: catalogStatusSchema,
  deactivatedAt: z.iso.datetime().nullable(),
  allowedServiceIds: z.array(z.uuid()),
  createdAt: z.iso.datetime(),
});

export type Room = z.infer<typeof roomSchema>;

export const createRoomRequestSchema = z.strictObject({
  name: catalogNameSchema,
  allowedServiceIds: z.array(z.uuid()),
});

export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>;

export const updateRoomRequestSchema = createRoomRequestSchema;

export type UpdateRoomRequest = z.infer<typeof updateRoomRequestSchema>;

export const roomResponseSchema = z.strictObject({ room: roomSchema });

export type RoomResponse = z.infer<typeof roomResponseSchema>;

export const roomListResponseSchema = z.strictObject({
  rooms: z.array(roomSchema),
});

export type RoomListResponse = z.infer<typeof roomListResponseSchema>;
