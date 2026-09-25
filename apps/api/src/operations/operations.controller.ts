import { Controller, Get } from '@nestjs/common';
import type { BackupStatusResponse } from '@clinic/contracts';
import { RequirePermissions } from '../auth/decorators/endpoint-access';
import { BackupStatusService } from './backup-status.service';

/**
 * Milestone 10, checkpoint A2 — the one operational read a manager needs: is
 * there a recent backup off the server?
 *
 * `user.read` AND NO NEW PERMISSION. Seeing whether the clinic's data would
 * survive losing the server is system administration, which PROJECT_SPEC.md 4
 * keeps with the manager, and `user.read` is the manager-only name for exactly
 * that kind of oversight. The response carries two timestamps and a state; a
 * new name would be vocabulary for one read, and it would widen nothing the
 * receptionist holds either way.
 */
@Controller('operations')
export class OperationsController {
  constructor(private readonly backupStatus: BackupStatusService) {}

  @Get('backup-status')
  @RequirePermissions('user.read')
  status(): Promise<BackupStatusResponse> {
    return this.backupStatus.status();
  }
}
