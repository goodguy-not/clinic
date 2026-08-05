import { z } from 'zod';
import { catalogNameSchema, catalogStatusSchema, durationMinutesSchema } from './common';

/**
 * A clinic service, with the session lengths it may be booked for.
 *
 * `isPublic` and `publicDescription` are recorded here and read by nothing yet:
 * the public website is a later milestone. They live on the service because
 * that is where the fact belongs, not because anything in this milestone
 * renders them.
 */
export const serviceSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  publicDescription: z.string().nullable(),
  isPublic: z.boolean(),
  status: catalogStatusSchema,
  deactivatedAt: z.iso.datetime().nullable(),
  allowedDurationsMinutes: z.array(durationMinutesSchema),
  createdAt: z.iso.datetime(),
});

export type Service = z.infer<typeof serviceSchema>;

/**
 * At least one duration, because a service nothing can be booked for is not
 * usable and a tariff cannot be priced against it — the tariff table carries a
 * foreign key to `(service_id, duration_minutes)`.
 */
export const createServiceRequestSchema = z.strictObject({
  name: catalogNameSchema,
  publicDescription: z.string().trim().max(2000).nullable(),
  isPublic: z.boolean(),
  allowedDurationsMinutes: z.array(durationMinutesSchema).min(1),
});

export type CreateServiceRequest = z.infer<typeof createServiceRequestSchema>;

export const updateServiceRequestSchema = createServiceRequestSchema;

export type UpdateServiceRequest = z.infer<typeof updateServiceRequestSchema>;

export const serviceResponseSchema = z.strictObject({ service: serviceSchema });

export type ServiceResponse = z.infer<typeof serviceResponseSchema>;

export const serviceListResponseSchema = z.strictObject({
  services: z.array(serviceSchema),
});

export type ServiceListResponse = z.infer<typeof serviceListResponseSchema>;
