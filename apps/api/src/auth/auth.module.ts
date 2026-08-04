import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

/**
 * `SessionService` is exported because the global `SessionGuard` is constructed
 * in the root injector and needs it. Nothing else outside this module resolves
 * sessions.
 */
@Module({
  imports: [AuditModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, SessionService],
  exports: [SessionService],
})
export class AuthModule {}
