import { Module } from '@nestjs/common';
import { BackupStatusService } from './backup-status.service';
import { JobStatusService } from './job-status.service';
import { OperationsController } from './operations.controller';

/**
 * Milestone 10, checkpoints A2 and A3. Operational status for managers. It
 * owns no table: it reads the collector's status file and `scheduled_job`,
 * which the nightly jobs write.
 */
@Module({
  controllers: [OperationsController],
  providers: [BackupStatusService, JobStatusService],
})
export class OperationsModule {}
