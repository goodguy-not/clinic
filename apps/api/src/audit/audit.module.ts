import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * Audit is a plain provider module rather than a global one.
 *
 * A module that wants to write audit rows has to import this explicitly, which
 * keeps the set of modules with audit-writing ability visible in the dependency
 * graph rather than ambient.
 */
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
