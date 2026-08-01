import { Controller, Get, Headers, Post, Query, Req, Res } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './auth.models.js';
import { PublicRoute } from './public.decorator.js';

interface ResponseLike {
  setHeader(name: string, value: string | string[]): void;
  redirect(statusOrUrl: number | string, url?: string): void;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('login')
  @PublicRoute()
  async login(@Query('returnTo') returnTo: string | undefined, @Res() response: ResponseLike) {
    response.redirect(302, await this.auth.beginLogin(returnTo));
  }

  @Get('callback')
  @PublicRoute()
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Res() response: ResponseLike,
  ) {
    const result = await this.auth.completeLogin(code, state, userAgent);
    response.setHeader('Set-Cookie', this.auth.sessionCookieHeaders(result));
    const webOrigin = String(process.env.SPORTOS_WEB_ORIGIN ?? 'http://localhost:4200').replace(/\/$/, '');
    response.redirect(302, `${webOrigin}${result.returnTo}`);
  }

  @Post('dev-session')
  @PublicRoute()
  async developmentSession(
    @Headers('authorization') authorization: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const result = await this.auth.createDevelopmentSession(authorization, userAgent);
    response.setHeader('Set-Cookie', this.auth.sessionCookieHeaders(result));
    return { account: result.session.account, expiresAt: result.session.expiresAt };
  }

  @Get('session')
  session(@Req() request: AuthenticatedRequest) {
    return {
      account: request.account,
      expiresAt: request.authSession?.expiresAt,
      absoluteExpiresAt: request.authSession?.absoluteExpiresAt,
    };
  }

  @Post('logout')
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    if (request.authSession) await this.auth.revokeSession(request.authSession.id);
    response.setHeader('Set-Cookie', this.auth.clearCookieHeaders());
    return { signedOut: true };
  }
}
