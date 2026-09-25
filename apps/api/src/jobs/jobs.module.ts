import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { WebsiteModule } from '../website/website.module';
import { ScheduledJobsService } from './scheduled-jobs.service';

/**
 * Milestone 10, checkpoint A3. The nightly jobs' runner, imported by the CLI
 * only: the API server never runs a job, it only reports when each last
 * succeeded (`OperationsModule`). Each job is a service of the module that
 * owns its table; this module only orders them and records the outcome.
 */
@Module({
  imports: [AuditModule, AuthModule, MediaModule, WebsiteModule],
  providers: [ScheduledJobsService],
  exports: [ScheduledJobsService],
})
export class JobsModule {}
