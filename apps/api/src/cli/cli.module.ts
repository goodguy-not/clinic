import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * The CLI runs as a standalone application context: no HTTP server, no guards,
 * no controllers.
 *
 * It imports the real services rather than reaching for Prisma directly, so
 * bootstrap and recovery hash passwords with the same Argon2 configuration,
 * validate against the same policy, and write audit rows through the same
 * transaction-bound service as the running application. A CLI with its own
 * copy of any of those would drift, and the drift would only be discovered
 * during an incident.
 */
@Module({
  imports: [ConfigModule, PrismaModule, AuditModule, AuthModule],
})
export class CliModule {}
