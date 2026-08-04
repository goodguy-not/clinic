import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

/**
 * `SessionService` is exported because the global `SessionGuard` is constructed
 * in the root injector and needs it; `PasswordService` because staff
 * administration and the recovery CLI must hash with the same Argon2
 * configuration rather than their own.
 */
@Module({
  imports: [AuditModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, SessionService],
  exports: [SessionService, PasswordService],
})
export class AuthModule {}
