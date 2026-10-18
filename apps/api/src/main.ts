import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { loadDotEnvIfPresent, loadEnv } from './config/env';
import { describeError } from './common/describe-error';

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
  // The kind of failure, never its message: PrismaService connects during
  // module initialisation, so a startup failure here can be a driver error
  // carrying the full connection string. An invalid environment is the one
  // message that is let through — it names variables, never their values.
  Logger.error(describeError(error), 'Bootstrap');
  process.exit(1);
});
