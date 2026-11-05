import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { LEGACY_ACCOUNT_ID, McpOAuthRepository } from '@sportos/db';
import type { DbProvider } from '../db.provider.js';
import type { AuthenticatedRequest } from '../auth/auth.models.js';
import { AuthService } from '../auth/auth.service.js';
import { CHATGPT_REDIRECT, McpOAuthService, mcpConfig } from './mcp-oauth.service.js';
const origin = 'https://api.sportos.example';
const verifier = 'v'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const authorize = () => ({ client_id: 'sportos-chatgpt', redirect_uri: CHATGPT_REDIRECT,
  resource: origin + '/mcp', response_type: 'code', scope: 'athlete:read', state: 'state-fixture', code_challenge: challenge, code_challenge_method: 'S256' });
const exchange = () => ({ grant_type: 'authorization_code', client_id: 'sportos-chatgpt',
  redirect_uri: CHATGPT_REDIRECT, resource: origin + '/mcp', code: 'c'.repeat(43), code_verifier: verifier });
const browser = (): AuthenticatedRequest => ({ method: 'POST', url: '/mcp/oauth/approve', headers: {}, authTransport: 'cookie',
  authSession: { id: 'browser-fixture', account: { id: LEGACY_ACCOUNT_ID, displayName: 'Fixture', email: null },
    csrfHash: 'c'.repeat(64), expiresAt: '2099-01-01', absoluteExpiresAt: '2099-01-02' } });
let service: McpOAuthService;
let owners: string[];
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('SPORTOS_AUTH_MODE', 'single-user');
  vi.stubEnv('SPORTOS_MCP_PUBLIC_ORIGIN', origin); vi.stubEnv('SPORTOS_WEB_ORIGIN', 'https://web.sportos.example');
  owners = [];
  service = new McpOAuthService({ db: {}, withAccount: async (id: string, run: (db: unknown) => unknown) => { owners.push(id); return run({}); } } as unknown as DbProvider);
  vi.spyOn(McpOAuthRepository.prototype, 'create').mockResolvedValue();
  vi.spyOn(McpOAuthRepository.prototype, 'approve').mockResolvedValue({ redirect_uri: CHATGPT_REDIRECT, state: 'state-fixture' });
  vi.spyOn(McpOAuthRepository.prototype, 'exchange').mockResolvedValue(new Date(Date.now() + 3600000));
  vi.spyOn(McpOAuthRepository.prototype, 'authenticate').mockResolvedValue(LEGACY_ACCOUNT_ID);
  vi.spyOn(McpOAuthRepository.prototype, 'revokeToken').mockResolvedValue();
  vi.spyOn(McpOAuthRepository.prototype, 'revokeAccount').mockResolvedValue();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe('ChatGPT OAuth boundary', () => {
  it('is opt-in and validates the exact public HTTPS origin', () => {
    expect(mcpConfig({})).toBeNull();
    for (const value of ['http://api.example', origin + '/', origin + '/api', origin + '?token=x', 'https://u:p@api.example', origin + '#x']) {
      expect(() => mcpConfig({ NODE_ENV: 'production', SPORTOS_MCP_PUBLIC_ORIGIN: value })).toThrow();
    }
    expect(mcpConfig({ SPORTOS_MCP_PUBLIC_ORIGIN: origin })?.resource).toBe(origin + '/mcp');
    vi.stubEnv('SPORTOS_MCP_PUBLIC_ORIGIN', ''); expect(() => service.resourceMetadata()).toThrow(NotFoundException);
  });
  it('publishes only the scoped public-client code flow with issuer identification', () => {
    expect(service.resourceMetadata()).toMatchObject({ resource: origin + '/mcp', authorization_servers: [origin], scopes_supported: ['athlete:read'] });
    expect(service.authorizationMetadata()).toMatchObject({ issuer: origin, grant_types_supported: ['authorization_code'], token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'], authorization_response_iss_parameter_supported: true });
    expect(service.authorizationMetadata()).not.toHaveProperty('registration_endpoint');
  });
  it('retains only a request digest and redirects to the configured SportOS browser', async () => {
    const url = new URL(await service.authorize(authorize()));
    expect(url.origin).toBe('https://web.sportos.example'); expect(url.pathname).toBe('/mcp-connect');
    const input = vi.mocked(McpOAuthRepository.prototype.create).mock.calls[0]![0];
    expect(input.requestHash).toBe(sha(url.searchParams.get('request')!));
    expect(input).toMatchObject({ clientId: 'sportos-chatgpt', redirectUri: CHATGPT_REDIRECT, resource: origin + '/mcp', codeChallenge: challenge });
    expect(input).not.toHaveProperty('accountId');
  });
  it('accepts ChatGPT locale hints without retaining them or changing authorization', async () => {
    await service.authorize({ ...authorize(), ui_locales: 'en-US da' });
    const retained = vi.mocked(McpOAuthRepository.prototype.create).mock.calls[0]![0];
    expect(retained).not.toHaveProperty('ui_locales');
    expect(retained).not.toHaveProperty('locale');
    expect(retained.clientId).toBe('sportos-chatgpt');
  });
  it('rejects malformed or oversized locale hints', async () => {
    for (const ui_locales of ['https://evil.example', 'en-US<script>', 'a'.repeat(101), 'en\nUS', '']) {
      await expect(service.authorize({ ...authorize(), ui_locales })).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(McpOAuthRepository.prototype.create).not.toHaveBeenCalled();
  });
  it.each([
    { redirect_uri: 'https://evil.example/callback' }, { client_id: 'evil' }, { resource: 'https://evil.example/mcp' },
    { scope: 'athlete:write' }, { code_challenge_method: 'plain' }, { response_type: 'token' }, { state: '' },
    { state: 'a\nb' }, { code_challenge: 'x' }, { ownerId: LEGACY_ACCOUNT_ID }, { client_id: ['sportos-chatgpt'] },
  ])('rejects authorization tampering before persistence: %j', async overrides => {
    await expect(service.authorize({ ...authorize(), ...overrides })).rejects.toBeInstanceOf(BadRequestException);
    expect(McpOAuthRepository.prototype.create).not.toHaveBeenCalled();
  });
  it('requires a real browser session and binds approval only to that account', async () => {
    for (const bad of [{ ...browser(), authTransport: 'bearer' }, { ...browser(), authSession: undefined },
      { ...browser(), authSession: { ...browser().authSession!, id: 'dev-single-user' } }]) {
      await expect(service.approve({ requestId: 'r'.repeat(43) }, bad as AuthenticatedRequest)).rejects.toBeInstanceOf(ForbiddenException);
    }
    await expect(service.approve({ requestId: 'r'.repeat(43), ownerId: 'foreign' }, browser())).rejects.toThrow();
    const callback = new URL((await service.approve({ requestId: 'r'.repeat(43) }, browser())).redirectUrl);
    expect(callback.origin + callback.pathname).toBe(CHATGPT_REDIRECT);
    expect(callback.searchParams.get('iss')).toBe(origin); expect(callback.searchParams.get('state')).toBe('state-fixture');
    expect(owners).toEqual([LEGACY_ACCOUNT_ID]);
    expect(McpOAuthRepository.prototype.approve).toHaveBeenCalledWith({ requestHash: sha('r'.repeat(43)), accountId: LEGACY_ACCOUNT_ID,
      sessionId: 'browser-fixture', codeHash: sha(callback.searchParams.get('code')!) });
  });
  it('issues an MCP-specific token from an exact PKCE/resource/client/redirect-bound exchange', async () => {
    const result = await service.token(exchange(), {});
    expect(result.access_token).toMatch(/^smc_[A-Za-z0-9_-]{64}$/); expect(result.scope).toBe('athlete:read');
    expect(result.expires_in).toBeGreaterThan(0); expect(result).not.toHaveProperty('refresh_token');
    expect(McpOAuthRepository.prototype.exchange).toHaveBeenCalledWith(expect.objectContaining({
      tokenHash: sha(result.access_token), codeHash: sha('c'.repeat(43)), codeChallenge: challenge, resource: origin + '/mcp',
      redirectUri: CHATGPT_REDIRECT, clientId: 'sportos-chatgpt',
    }));
    expect(JSON.stringify(vi.mocked(McpOAuthRepository.prototype.exchange).mock.calls)).not.toContain(result.access_token);
    expect(await new AuthService({ db: {} } as DbProvider).authenticate(result.access_token)).toBeNull();
    expect(await new AuthService({ db: {} } as DbProvider).authenticate(result.access_token, 'mobile')).toBeNull();
    vi.mocked(McpOAuthRepository.prototype.exchange).mockResolvedValueOnce(null);
    await expect(service.token(exchange(), {})).rejects.toMatchObject({ response: { error: 'invalid_grant' } });
  });
  it('rejects token exchange tampering, passwords, browser cookies and ambient credentials', async () => {
    for (const overrides of [{ resource: 'https://other/mcp' }, { redirect_uri: 'https://evil.example' }, { client_id: 'other' },
      { grant_type: 'refresh_token' }, { code_verifier: 'bad' }, { ownerId: 'foreign' }, { password: 'secret' }]) {
      await expect(service.token({ ...exchange(), ...overrides }, {})).rejects.toThrow();
    }
    for (const headers of [{ cookie: 'sportos_session=x' }, { authorization: 'Bearer smo_x' }, { origin: 'https://chatgpt.com' }]) {
      await expect(service.token(exchange(), headers)).rejects.toThrow();
    }
    expect(McpOAuthRepository.prototype.exchange).not.toHaveBeenCalled();
  });
  it('rejects other credential channels and inactive/foreign account results', async () => {
    for (const headers of [{}, { authorization: 'Bearer browser-cookie' }, { authorization: 'Bearer smo_' + 'a'.repeat(64) },
      { authorization: ['Bearer smc_' + 'a'.repeat(64)] }, { authorization: 'Bearer smc_' + 'a'.repeat(64), cookie: 'x' },
      { authorization: 'Bearer smc_' + 'a'.repeat(64), origin: 'https://evil.example' }]) {
      expect(await service.authenticate(headers)).toBeNull();
    }
    const headers = { authorization: 'Bearer smc_' + 'a'.repeat(64) };
    expect(await service.authenticate(headers)).toBe(LEGACY_ACCOUNT_ID);
    vi.mocked(McpOAuthRepository.prototype.authenticate).mockResolvedValueOnce('foreign');
    expect(await service.authenticate(headers)).toBeNull();
    vi.mocked(McpOAuthRepository.prototype.authenticate).mockResolvedValueOnce(null);
    expect(await service.authenticate(headers)).toBeNull();
  });
  it('revokes the exact token or only the authenticated account', async () => {
    await service.revoke({ client_id: 'sportos-chatgpt', token: 'smc_' + 't'.repeat(64) }, {});
    expect(McpOAuthRepository.prototype.revokeToken).toHaveBeenCalledWith(sha('smc_' + 't'.repeat(64)), 'sportos-chatgpt');
    await service.revokeAccount(browser()); expect(McpOAuthRepository.prototype.revokeAccount).toHaveBeenCalledWith(LEGACY_ACCOUNT_ID);
    await expect(service.revokeAccount({ ...browser(), authTransport: 'bearer' })).rejects.toThrow();
  });
});
