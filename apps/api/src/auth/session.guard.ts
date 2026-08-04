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
    const cookies = parseCookies(headerValue(request.headers.cookie));
    const session = await this.auth.authenticate(cookies.sportos_session ?? null);
    if (!session) {
      throw new UnauthorizedException({ code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required.' });
    }

    request.account = session.account;
    request.authSession = session;

    if (!SAFE_METHODS.has(String(request.method ?? '').toUpperCase())) {
      const csrfHeader = headerValue(request.headers['x-sportos-csrf']);
      if (!this.auth.verifyCsrf(session, cookies.sportos_csrf ?? null, csrfHeader)) {
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
