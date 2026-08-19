import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppointmentsModule } from './appointments/appointments.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AvailabilityModule } from './availability/availability.module';
import { CatalogModule } from './catalog/catalog.module';
import { FamiliesModule } from './families/families.module';
import { LedgerModule } from './ledger/ledger.module';
import { PaymentsModule } from './payments/payments.module';
import { InternalKeyGuard } from './auth/guards/internal-key.guard';
import { PermissionsGuard } from './auth/guards/permissions.guard';
import { SessionGuard } from './auth/guards/session.guard';
import { ErrorEnvelopeFilter } from './common/error-envelope.filter';
import { NoStoreInterceptor } from './common/no-store.interceptor';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReportsModule } from './reports/reports.module';
import { SettlementModule } from './settlement/settlement.module';
import { UsersModule } from './users/users.module';

/**
 * Root of the modular monolith.
 *
 * The three guards are registered in order and NestJS runs them in that order,
 * which is what the design depends on: prove the request crossed the private
 * boundary, then establish who is asking, then check what they may do. Each is
 * global, so a new controller is protected by default and an unclassified route
 * is denied by the first guard rather than silently exposed.
 *
 * Domain modules (users, catalog, family, appointment, ledger, payment, report,
 * settlement, website) are added one milestone at a time; each owns its own tables and is
 * the only code that queries them.
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    CatalogModule,
    AvailabilityModule,
    AppointmentsModule,
    LedgerModule,
    PaymentsModule,
    FamiliesModule,
    ReportsModule,
    SettlementModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: InternalKeyGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: NoStoreInterceptor },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
  ],
})
export class AppModule {}
