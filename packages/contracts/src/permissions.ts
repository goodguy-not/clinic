import { z } from 'zod';

/**
 * Every permission that exists in Milestone 1.
 *
 * Later milestones append to this list; the guard design in `apps/api` does not
 * change when they do.
 *
 * These names live here because Next needs them to decide whether to render a
 * management surface. The authoritative role -> permission map lives in
 * `apps/api` and nowhere else: Next never derives permissions from a role, it
 * only reads the resolved list NestJS returns, and NestJS re-resolves them from
 * the database on every request.
 */
export const PERMISSIONS = [
  'user.read',
  'user.create',
  'user.update_role',
  'user.update_status',
  'user.reset_password',
  'user.unlock',
  'session.revoke_any',

  // Clinic reference data. Manager-only: PROJECT_SPEC.md 4 places configuration
  // with the manager and explicitly bars the receptionist from global tariff
  // changes. The receptionist holds none of these until a workflow needs them,
  // which is the appointment milestone, not this one.
  'therapist.read',
  'therapist.create',
  'therapist.update',
  'therapist.update_status',
  'service.read',
  'service.create',
  'service.update',
  'service.update_status',
  'room.read',
  'room.create',
  'room.update',
  'room.update_status',
  'tariff.read',
  'tariff.create',
  // Voiding is separate from creating: a correction to a price already in
  // effect is a different authority from setting one, and later milestones may
  // grant them differently.
  'tariff.void',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const permissionSchema = z.enum(PERMISSIONS);
