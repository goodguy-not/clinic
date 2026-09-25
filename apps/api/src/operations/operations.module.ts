import { Module } from '@nestjs/common';
import { BackupStatusService } from './backup-status.service';
import { OperationsController } from './operations.controller';

/** Milestone 10, checkpoint A2. Operational status for managers; owns no table. */
@Module({
  controllers: [OperationsController],
  providers: [BackupStatusService],
})
export class OperationsModule {}
