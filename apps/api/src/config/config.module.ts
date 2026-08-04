import { Global, Module } from '@nestjs/common';
import { loadEnv, type ApiEnv } from './env';

/**
 * Injection token for the validated environment.
 *
 * Guards and services take the parsed object rather than reading `process.env`
 * directly, so a test can supply a synthetic environment without mutating
 * global state, and so an invalid value stops the process at startup instead of
 * surfacing as `undefined` inside a security comparison.
 */
export const API_ENV = Symbol('API_ENV');

@Global()
@Module({
  providers: [{ provide: API_ENV, useFactory: (): ApiEnv => loadEnv() }],
  exports: [API_ENV],
})
export class ConfigModule {}
