import { PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { AppError } from './app-error';

/**
 * Validates a request body against a schema from `@clinic/contracts`.
 *
 * Zod is the one validation system in this repository; `class-validator` is
 * deliberately absent so there is no second source of truth about request
 * shape. Because the contract schemas are strict, an unexpected field is a
 * validation failure rather than something silently ignored.
 *
 * `details` carries Zod's flattened field errors. That is safe to return: it
 * names fields and states why they failed, and never echoes a password value —
 * the password schemas assert only "not empty", so no length or content detail
 * about a rejected secret can appear here.
 */
export class ZodBodyPipe<T extends ZodType> implements PipeTransform<unknown, T['_output']> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): T['_output'] {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new AppError('VALIDATION_FAILED', {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      });
    }

    return result.data;
  }
}
