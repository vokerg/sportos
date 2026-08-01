import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service.js';
import { SessionGuard } from './session.guard.js';
import type { AuthenticatedRequest, AuthenticatedSession } from './auth.models.js';

const session: AuthenticatedSession = {
  id: '11111111-1111-4111-8111-111111111111',
  account: { id: '22222222-2222-4222-8222-222222222222', displayName: 'Athlete', email: null },
  csrfHash: 'a'.repeat(64),
  expiresAt: '2099-01-01T00:00:00.000Z',
  absoluteExpiresAt: '2099-01-02T00:00:00.000Z',
};

describe('SessionGuard', () => {
  it('allows explicitly public routes without reading cookies', async () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(true) } as unknown as Reflector;
    const auth = { authenticate: vi.fn() } as unknown as AuthService;
    await expect(new SessionGuard(reflector, auth).canActivate(context(request('GET')))).resolves.toBe(true);
    expect(auth.authenticate).not.toHaveBeenCalled();
  });

  it('rejects missing sessions with a generic unauthorized response', async () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector;
    const auth = { authenticate: vi.fn().mockResolvedValue(null) } as unknown as AuthService;
    await expect(new SessionGuard(reflector, auth).canActivate(context(request('GET')))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches the authenticated account for safe methods', async () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector;
    const auth = { authenticate: vi.fn().mockResolvedValue(session) } as unknown as AuthService;
    const req = request('GET', 'sportos_session=token-value');
    await expect(new SessionGuard(reflector, auth).canActivate(context(req))).resolves.toBe(true);
    expect(req.account).toEqual(session.account);
    expect(req.authSession).toEqual(session);
  });

  it('requires a session-bound csrf token for mutations', async () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector;
    const auth = {
      authenticate: vi.fn().mockResolvedValue(session),
      verifyCsrf: vi.fn().mockReturnValue(false),
    } as unknown as AuthService;
    const req = request('POST', 'sportos_session=token-value; sportos_csrf=csrf-value');
    await expect(new SessionGuard(reflector, auth).canActivate(context(req))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a mutation only when csrf validation succeeds', async () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector;
    const auth = {
      authenticate: vi.fn().mockResolvedValue(session),
      verifyCsrf: vi.fn().mockReturnValue(true),
    } as unknown as AuthService;
    const req = request('POST', 'sportos_session=token-value; sportos_csrf=csrf-value');
    req.headers['x-sportos-csrf'] = 'csrf-value';
    await expect(new SessionGuard(reflector, auth).canActivate(context(req))).resolves.toBe(true);
    expect(auth.verifyCsrf).toHaveBeenCalledWith(session, 'csrf-value', 'csrf-value');
  });
});

function request(method: string, cookie?: string): AuthenticatedRequest {
  return { method, url: '/protected', headers: cookie ? { cookie } : {} };
}

function context(req: AuthenticatedRequest): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}), getNext: () => undefined }),
  } as unknown as ExecutionContext;
}
