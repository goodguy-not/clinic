import { z } from 'zod';
import { catalogNameSchema, catalogStatusSchema } from './common';

/**
 * A therapist as clinic reference data.
 *
 * Not an account: therapist login is a later, separately approved decision
 * (PROJECT_SPEC.md 4), so there is no username, no password and no relation to
 * a staff user here.
 *
 * There is deliberately no share or settlement percentage. PROJECT_SPEC.md 5
 * calls that rule "later" and 16 assigns it to the settlement milestone, where
 * it must be effective-dated and snapshotted per session — a plain column on
 * this row would be the wrong shape for it and would invite writing one.
 */
export const therapistSchema = z.strictObject({
  id: z.uuid(),
  fullName: z.string(),
  specialty: z.string(),
  status: catalogStatusSchema,
  deactivatedAt: z.iso.datetime().nullable(),
  supportedServiceIds: z.array(z.uuid()),
  createdAt: z.iso.datetime(),
});

export type Therapist = z.infer<typeof therapistSchema>;

export const createTherapistRequestSchema = z.strictObject({
  fullName: catalogNameSchema,
  specialty: catalogNameSchema,
  supportedServiceIds: z.array(z.uuid()),
});

export type CreateTherapistRequest = z.infer<typeof createTherapistRequestSchema>;

export const updateTherapistRequestSchema = createTherapistRequestSchema;

export type UpdateTherapistRequest = z.infer<typeof updateTherapistRequestSchema>;

export const therapistResponseSchema = z.strictObject({ therapist: therapistSchema });

export type TherapistResponse = z.infer<typeof therapistResponseSchema>;

export const therapistListResponseSchema = z.strictObject({
  therapists: z.array(therapistSchema),
});

export type TherapistListResponse = z.infer<typeof therapistListResponseSchema>;
