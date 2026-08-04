import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Staff administration. Imports `AuthModule` for the password and session
 * services rather than reimplementing hashing or revocation, so there is one
 * Argon2 configuration and one definition of what revoking a session means.
 */
@Module({
  imports: [AuditModule, AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
