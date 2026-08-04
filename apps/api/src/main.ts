import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { loadDotEnvIfPresent, loadEnv } from './config/env';
import { redactSecrets } from './common/redact';

async function bootstrap(): Promise<void> {
  loadDotEnvIfPresent();

  // Fail fast: an invalid environment stops the process before anything binds
  // a port or opens a database connection.
  const env = loadEnv();

  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks();

  await app.listen(env.API_PORT);
  Logger.log(`API listening on http://localhost:${env.API_PORT} [${env.NODE_ENV}]`, 'Bootstrap');
}

void bootstrap().catch((error: unknown) => {
  // Redacted: PrismaService connects during module initialisation, so a startup
  // failure here can be a driver error carrying the full connection string.
  Logger.error(redactSecrets(error instanceof Error ? error.message : String(error)), 'Bootstrap');
  process.exit(1);
});
