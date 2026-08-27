import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WebsiteModule } from '../website/website.module';

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
 *
 * `WebsiteModule` IS IMPORTED FOR THE SAME REASON (Milestone 9, checkpoint A4).
 * The ninety-day erasure lives beside the table it erases, in
 * `WebsiteRequestRetentionService`, and this process reaches it rather than
 * writing its own UPDATE — a retention run with a private copy of the
 * eligibility predicate is exactly the drift that destroys the wrong rows.
 * Importing the module also brings its controllers into the container, which is
 * inert here: an application context registers no HTTP server and no route.
 */
@Module({
  imports: [ConfigModule, PrismaModule, AuditModule, AuthModule, WebsiteModule],
})
export class CliModule {}
