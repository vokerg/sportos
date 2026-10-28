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
  it('never bypasses native revocation or browser approval in local development mode', async () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector;
    const auth = {
      isDevelopmentMode: vi.fn().mockReturnValue(true), getDevelopmentSession: vi.fn(),
      authenticate: vi.fn().mockResolvedValue(null), verifyCsrf: vi.fn(),
    } as unknown as AuthService;
    const bearer = request('GET'); bearer.headers.authorization = 'Bearer smo_' + 'a'.repeat(64);
    await expect(new SessionGuard(reflector, auth).canActivate(context(bearer))).rejects.toBeInstanceOf(UnauthorizedException);
    const approve = request('POST'); approve.url = '/auth/mobile/approve';
    await expect(new SessionGuard(reflector, auth).canActivate(context(approve))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(auth.getDevelopmentSession).not.toHaveBeenCalled();
  });
  it('allows explicitly public routes without reading cookies', async () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(true) } as unknown as Reflector;
    const auth = { isDevelopmentMode: vi.fn().mockReturnValue(false), authenticate: vi.fn() } as unknown as AuthService;
    await expect(new SessionGuard(reflector, auth).canActivate(context(request('GET')))).resolves.toBe(true);
    expect(auth.authenticate).not.toHaveBeenCalled();
  });

  it('rejects missing sessions with a generic unauthorized response', async () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector;
    const auth = { isDevelopmentMode: vi.fn().mockReturnValue(false), authenticate: vi.fn().mockResolvedValue(null) } as unknown as AuthService;
    await expect(new SessionGuard(reflector, auth).canActivate(context(request('GET')))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('uses the fixed development account without cookies in dev-single-user mode', async () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector;
    const auth = {
      isDevelopmentMode: vi.fn().mockReturnValue(true),
      getDevelopmentSession: vi.fn().mockResolvedValue(session),
      authenticate: vi.fn(),
    } as unknown as AuthService;
    const req = request('POST');
    await expect(new SessionGuard(reflector, auth).canActivate(context(req))).resolves.toBe(true);
    expect(req.account).toEqual(session.account);
    expect(req.authSession).toEqual(session);
    expect(auth.authenticate).not.toHaveBeenCalled();
  });

  it('attaches the authenticated account for safe methods', async () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector;
    const auth = { isDevelopmentMode: vi.fn().mockReturnValue(false), authenticate: vi.fn().mockResolvedValue(session) } as unknown as AuthService;
    const req = request('GET', 'sportos_session=token-value');
    await expect(new SessionGuard(reflector, auth).canActivate(context(req))).resolves.toBe(true);
    expect(req.account).toEqual(session.account);
    expect(req.authSession).toEqual(session);
  });

  it('requires a session-bound csrf token for mutations', async () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector;
    const auth = {
      isDevelopmentMode: vi.fn().mockReturnValue(false),
      authenticate: vi.fn().mockResolvedValue(session),
      verifyCsrf: vi.fn().mockReturnValue(false),
    } as unknown as AuthService;
    const req = request('POST', 'sportos_session=token-value; sportos_csrf=csrf-value');
    await expect(new SessionGuard(reflector, auth).canActivate(context(req))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('authorizes only explicit mobile bearer tokens and does not require ambient CSRF', async () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector;
    const auth = {
      isDevelopmentMode: vi.fn().mockReturnValue(false),
      authenticate: vi.fn().mockResolvedValue(session),
      verifyCsrf: vi.fn(),
    } as unknown as AuthService;
    const req = request('POST');
    req.headers.authorization = 'Bearer smo_' + 'A'.repeat(64);
    await expect(new SessionGuard(reflector, auth).canActivate(context(req))).resolves.toBe(true);
    expect(req.authTransport).toBe('bearer');
    expect(req.account).toEqual(session.account);
    expect(auth.authenticate).toHaveBeenCalledWith('smo_' + 'A'.repeat(64), 'mobile');
    expect(auth.verifyCsrf).not.toHaveBeenCalled();
  });

  it('fails closed for malformed bearer, browser-token substitution, and mixed cookie+bearer credentials', async () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector;
    const auth = {
      isDevelopmentMode: vi.fn().mockReturnValue(false), authenticate: vi.fn(),
    } as unknown as AuthService;
    for (const authorization of ['Bearer browser-token', 'Basic abc', 'Bearer smo_bad', 'Bearer smo_' + 'A'.repeat(64) + ', Bearer x']) {
      const req = request('GET');
      req.headers.authorization = authorization;
      await expect(new SessionGuard(reflector, auth).canActivate(context(req))).rejects.toBeInstanceOf(UnauthorizedException);
    }
    const mixed = request('POST', 'sportos_session=cookie');
    mixed.headers.authorization = 'Bearer smo_' + 'A'.repeat(64);
    await expect(new SessionGuard(reflector, auth).canActivate(context(mixed))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(auth.authenticate).not.toHaveBeenCalled();
  });

  it('refuses revoked or expired bearer sessions without falling back to a cookie', async () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector;
    const auth = {
      isDevelopmentMode: vi.fn().mockReturnValue(false),
      authenticate: vi.fn().mockResolvedValue(null),
    } as unknown as AuthService;
    const req = request('DELETE');
    req.headers.authorization = 'Bearer smo_' + 'A'.repeat(64);
    await expect(new SessionGuard(reflector, auth).canActivate(context(req))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(req.account).toBeUndefined();
  });

  it('allows a mutation only when csrf validation succeeds', async () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector;
    const auth = {
      isDevelopmentMode: vi.fn().mockReturnValue(false),
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
