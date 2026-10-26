import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './auth.models.js';
import { PUBLIC_ROUTE_KEY } from './public.decorator.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (this.auth.isDevelopmentMode()) {
      const session = await this.auth.getDevelopmentSession();
      request.account = session.account;
      request.authSession = session;
      return true;
    }


    // Bearer credentials are never ambient; they must not be mixed with cookies.
    // An invalid Authorization header must not fall back to browser cookies.
    const authorization = request.headers.authorization;
    const cookieHeader = headerValue(request.headers.cookie);
    const bearerAttempt = authorization !== undefined;
    let session: AuthenticatedSession | null;
    if (bearerAttempt) {
      if (Array.isArray(authorization) || typeof authorization !== 'string'
        || !/^Bearer smo_[A-Za-z0-9_-]{64}$/.test(authorization) || cookieHeader) {
        throw new UnauthorizedException({ code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required.' });
      }
      session = await this.auth.authenticate(authorization.slice(7), 'mobile');
      request.authTransport = 'bearer';
    } else {
      const browserToken = parseCookies(cookieHeader).sportos_session ?? null;
      session = await this.auth.authenticate(browserToken);
      request.authTransport = 'cookie';
    }
    if (!session) {
      throw new UnauthorizedException({ code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required.' });
    }

    request.account = session.account;
    request.authSession = session;

    if (request.authTransport === 'cookie' && !SAFE_METHODS.has(String(request.method ?? '').toUpperCase())) {
      const csrfHeader = headerValue(request.headers['x-sportos-csrf']);
      if (!this.auth.verifyCsrf(session, parseCookies(cookieHeader).sportos_csrf ?? null, csrfHeader)) {
        throw new ForbiddenException({ code: 'CSRF_VALIDATION_FAILED', message: 'The request could not be verified.' });
      }
    }
    return true;
  }
}

export function parseCookies(value: string | null): Record<string, string> {
  if (!value) return {};
  const result: Record<string, string> = {};
  for (const part of value.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    if (!name) continue;
    try {
      result[name] = decodeURIComponent(rawValue);
    } catch {
      result[name] = rawValue;
    }
  }
  return result;
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
