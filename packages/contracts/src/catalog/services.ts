import { z } from 'zod';
import { catalogNameSchema, catalogStatusSchema, durationMinutesSchema } from './common';
import { publicSlugSchema } from '../website/common';

/**
 * A clinic service, with the session lengths it may be booked for.
 *
 * `isPublic` and `publicDescription` were recorded here from Milestone 2 and
 * read by nothing until Milestone 9 gave the clinic a website. They live on the
 * service because that is where the fact belongs.
 *
 * `publicSlug` AND `publicFirstPublishedAt` ARE MILESTONE 9, CHECKPOINT A2, and
 * they are on THIS shape rather than a separate public-presentation read
 * because publishing a service is not a separate authority: its public
 * description, its address and whether it is public at all are columns on the
 * catalog row, written by the same manager form under the same
 * `service.update` (DECISION_LOG, 2026-08-21). A therapist's public profile is
 * the opposite case and has a shape of its own, because publishing a PERSON is
 * a decision about that person and A1 gave it its own permission.
 *
 * `publicFirstPublishedAt` is read-only and exists so a management screen can
 * say WHY the slug field is no longer editable rather than discovering it from
 * a refusal: once the URL has been reachable it is a promise to everybody
 * holding it, and this product has no redirects.
 */
export const serviceSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  publicDescription: z.string().nullable(),
  isPublic: z.boolean(),
  publicSlug: publicSlugSchema.nullable(),
  publicFirstPublishedAt: z.iso.datetime().nullable(),
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
  // NO `publicSlug` (M10-A10, T-010): the database assigns every service its
  // address when the row is created, and it never changes. `serviceSchema`
  // reads it back for the manager to see.
  allowedDurationsMinutes: z.array(durationMinutesSchema).min(1),
});

export type CreateServiceRequest = z.infer<typeof createServiceRequestSchema>;

export const updateServiceRequestSchema = createServiceRequestSchema;

export type UpdateServiceRequest = z.infer<typeof updateServiceRequestSchema>;

/** Canonical cache identity emitted only by a Manager service mutation. */
export const servicePublicationIdentitySchema = z.strictObject({
  publicSlug: publicSlugSchema.nullable(),
  affectsPublicCache: z.boolean(),
});

export type ServicePublicationIdentity = z.infer<typeof servicePublicationIdentitySchema>;

/**
 * Reads return only `service`; Manager mutations additionally carry the exact
 * cache handshake. Optional here keeps the shared envelope parseable for both
 * endpoints without putting publication state on the service itself.
 */
export const serviceResponseSchema = z.strictObject({
  service: serviceSchema,
  publication: servicePublicationIdentitySchema.optional(),
});

export type ServiceResponse = z.infer<typeof serviceResponseSchema>;

export const serviceMutationResponseSchema = z.strictObject({
  service: serviceSchema,
  publication: servicePublicationIdentitySchema,
});

export type ServiceMutationResponse = z.infer<typeof serviceMutationResponseSchema>;

export const serviceListResponseSchema = z.strictObject({
  services: z.array(serviceSchema),
});

export type ServiceListResponse = z.infer<typeof serviceListResponseSchema>;
