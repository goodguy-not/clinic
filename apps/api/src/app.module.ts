import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';

/**
 * Root of the modular monolith. Domain modules (auth, catalog, family,
 * appointment, ledger, payment, report, website) are added one milestone at a
 * time; each owns its own tables and is the only code that queries them.
 */
@Module({
  imports: [PrismaModule, HealthModule],
})
export class AppModule {}
