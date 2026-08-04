import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  changePasswordRequestSchema,
  loginRequestSchema,
  type ChangePasswordRequest,
  type LoginRequest,
  type LoginResponse,
  type SessionResponse,
} from '@clinic/contracts';
import { ZodBodyPipe } from '../common/zod-validation.pipe';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { AuthService } from './auth.service';
import {
  AllowWhilePasswordChangePending,
  AuthenticatedOnly,
  InternalOnly,
} from './decorators/endpoint-access';
import { Ctx, CurrentSession } from './decorators/request.decorators';

/**
 * Authentication endpoints.
 *
 * These return English codes and messages only; Persian belongs to the web
 * tier. Bodies are validated against the shared contract schemas, which are
 * strict, so an unexpected field is a validation failure rather than something
 * quietly ignored.
 *
 * Every route carries explicit access metadata. `/auth/login` is `internal`
 * because there is no session yet but the request must still have crossed the
 * private boundary; the rest are `authenticated` and additionally marked as
 * reachable while a password change is outstanding, since they are exactly the
 * routes needed to clear that state.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @InternalOnly()
  login(
    @Body(new ZodBodyPipe(loginRequestSchema)) body: LoginRequest,
    @Ctx() context: RequestContext,
  ): Promise<LoginResponse> {
    return this.auth.login(body, context);
  }

  @Post('logout')
  @HttpCode(204)
  @AuthenticatedOnly()
  @AllowWhilePasswordChangePending()
  logout(
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<void> {
    return this.auth.logout(session, context);
  }

  @Get('session')
  @AuthenticatedOnly()
  @AllowWhilePasswordChangePending()
  session(@CurrentSession() session: ResolvedSession): SessionResponse {
    return { user: this.auth.currentSession(session) };
  }

  @Post('password')
  @HttpCode(200)
  @AuthenticatedOnly()
  @AllowWhilePasswordChangePending()
  changePassword(
    @Body(new ZodBodyPipe(changePasswordRequestSchema)) body: ChangePasswordRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<LoginResponse> {
    return this.auth.changePassword(body, session, context);
  }
}
