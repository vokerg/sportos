import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { LEGACY_ACCOUNT_ID, McpOAuthRepository } from '@sportos/db';
import { DbProvider } from '../db.provider.js';
import type { AuthenticatedRequest } from '../auth/auth.models.js';

export const MCP_SCOPE = 'athlete:read';
export const CHATGPT_REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const invalid = () => new BadRequestException({ error: 'invalid_request', error_description: 'Invalid SportOS connection request.' });

export function mcpConfig(env = process.env) {
  const value = env.SPORTOS_MCP_PUBLIC_ORIGIN;
  if (!value) return null;
  const origin = new URL(value);
  if (origin.origin !== value || origin.username || origin.password
    || (origin.protocol !== 'https:' && !(env.NODE_ENV !== 'production'
      && origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)))) {
    throw new Error('SPORTOS_MCP_PUBLIC_ORIGIN must be an exact HTTPS origin.');
  }
  return { origin: origin.origin, resource: `${origin.origin}/mcp`, clientId: 'sportos-chatgpt' };
}

@Injectable()
export class McpOAuthService {
  private readonly repository: McpOAuthRepository;
  private readonly window = { until: 0, count: 0 };
  constructor(private readonly database: DbProvider) {
    this.repository = new McpOAuthRepository(database.db);
  }
  config() {
    const config = mcpConfig();
    if (!config) throw new NotFoundException();
    return config;
  }
  resourceMetadata() {
    const c = this.config();
    return { resource: c.resource, authorization_servers: [c.origin], scopes_supported: [MCP_SCOPE], bearer_methods_supported: ['header'] };
  }
  authorizationMetadata() {
    const c = this.config();
    return { issuer: c.origin, authorization_endpoint: `${c.origin}/mcp/oauth/authorize`,
      token_endpoint: `${c.origin}/mcp/oauth/token`, revocation_endpoint: `${c.origin}/mcp/oauth/revoke`,
      response_types_supported: ['code'], grant_types_supported: ['authorization_code'],
      token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'],
      scopes_supported: [MCP_SCOPE], authorization_response_iss_parameter_supported: true };
  }
  async authorize(input: unknown) {
    const c = this.config();
    const v = fields(input, ['client_id', 'redirect_uri', 'resource', 'response_type', 'scope', 'state', 'code_challenge', 'code_challenge_method', 'ui_locales']);
    if (v.client_id !== c.clientId || v.redirect_uri !== CHATGPT_REDIRECT || v.resource !== c.resource
      || v.response_type !== 'code' || v.scope !== MCP_SCOPE || v.code_challenge_method !== 'S256'
      || !/^[A-Za-z0-9_-]{43}$/.test(v.code_challenge ?? '')
      || (v.ui_locales !== undefined && (v.ui_locales.length > 100 || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*(?: [A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)*$/.test(v.ui_locales)))
      || !v.state || v.state.length > 500 || /[\x00-\x20\x7f]/.test(v.state)) throw invalid();
    this.rateLimit();
    const requestId = random();
    await this.repository.create({ requestHash: digest(requestId), clientId: c.clientId,
      redirectUri: CHATGPT_REDIRECT, resource: c.resource, codeChallenge: v.code_challenge!,
      state: v.state, expiresAt: new Date(Date.now() + 5 * 60_000) });
    const web = String(process.env.SPORTOS_WEB_ORIGIN ?? 'http://localhost:4210').replace(/\/$/, '');
    return `${web}/mcp-connect?request=${requestId}`;
  }
  async approve(input: unknown, request: AuthenticatedRequest) {
    const c = this.config();
    this.requireBrowser(request);
    const v = fields(input, ['requestId']);
    if (!/^[A-Za-z0-9_-]{43}$/.test(v.requestId ?? '')) throw invalid();
    const code = random();
    const session = request.authSession!;
    const grant = await this.database.withAccount(session.account.id, db => new McpOAuthRepository(db).approve({
      requestHash: digest(v.requestId!), accountId: session.account.id, sessionId: session.id, codeHash: digest(code),
    }));
    if (!grant || grant.redirect_uri !== CHATGPT_REDIRECT) throw invalid();
    const url = new URL(grant.redirect_uri);
    url.searchParams.set('code', code); url.searchParams.set('state', grant.state); url.searchParams.set('iss', c.origin);
    return { redirectUrl: url.toString() };
  }
  async token(input: unknown, headers: Record<string, string | string[] | undefined>) {
    const c = this.config();
    if (headers.origin !== undefined || headers.cookie !== undefined || headers.authorization !== undefined) throw invalid();
    const v = fields(input, ['grant_type', 'client_id', 'redirect_uri', 'resource', 'code', 'code_verifier']);
    if (v.grant_type !== 'authorization_code' || v.client_id !== c.clientId || v.redirect_uri !== CHATGPT_REDIRECT
      || v.resource !== c.resource || !/^[A-Za-z0-9_-]{43}$/.test(v.code ?? '')
      || !/^[A-Za-z0-9._~-]{43,128}$/.test(v.code_verifier ?? '')) throw invalid();
    this.rateLimit();
    const token = `smc_${randomBytes(48).toString('base64url')}`;
    const expiresAt = await this.repository.exchange({ codeHash: digest(v.code!),
      codeChallenge: createHash('sha256').update(v.code_verifier!).digest('base64url'),
      clientId: c.clientId, redirectUri: CHATGPT_REDIRECT, resource: c.resource,
      tokenHash: digest(token), expiresAt: new Date(Date.now() + 12 * 60 * 60_000) });
    if (!expiresAt) throw new BadRequestException({ error: 'invalid_grant', error_description: 'Authorization expired or was already used.' });
    return { access_token: token, token_type: 'Bearer', expires_in: Math.max(0, Math.floor((expiresAt.valueOf() - Date.now()) / 1000)), scope: MCP_SCOPE };
  }
  async authenticate(headers: Record<string, string | string[] | undefined>) {
    const c = this.config();
    const authorization = headers.authorization;
    if (headers.cookie !== undefined || headers.origin !== undefined || typeof authorization !== 'string'
      || !/^Bearer smc_[A-Za-z0-9_-]{64}$/.test(authorization)) return null;
    const accountId = await this.repository.authenticate(digest(authorization.slice(7)), c.resource);
    if (process.env.SPORTOS_AUTH_MODE === 'single-user' && accountId !== LEGACY_ACCOUNT_ID) return null;
    return accountId;
  }
  async revoke(input: unknown, headers: Record<string, string | string[] | undefined>) {
    const c = this.config();
    if (headers.origin !== undefined || headers.cookie !== undefined || headers.authorization !== undefined) throw invalid();
    const v = fields(input, ['client_id', 'token', 'token_type_hint']);
    if (v.client_id !== c.clientId || !/^smc_[A-Za-z0-9_-]{64}$/.test(v.token ?? '')
      || (v.token_type_hint !== undefined && v.token_type_hint !== 'access_token')) throw invalid();
    this.rateLimit();
    await this.repository.revokeToken(digest(v.token!), c.clientId);
    return {};
  }
  async revokeAccount(request: AuthenticatedRequest) {
    this.config(); this.requireBrowser(request);
    await this.database.withAccount(request.authSession!.account.id,
      db => new McpOAuthRepository(db).revokeAccount(request.authSession!.account.id));
    return { revoked: true };
  }
  private requireBrowser(request: AuthenticatedRequest) {
    if (request.authTransport !== 'cookie' || !request.authSession || request.authSession.id === 'dev-single-user') {
      throw new ForbiddenException('An authenticated browser confirmation is required.');
    }
  }
  private rateLimit() {
    const now = Date.now();
    if (this.window.until <= now) { this.window.until = now + 60_000; this.window.count = 0; }
    if (++this.window.count > 60) throw new HttpException({ error: 'temporarily_unavailable' }, 429);
  }
}
function fields(value: unknown, allowed: string[]): Record<string, string | undefined> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.entries(value).some(([key, v]) => !allowed.includes(key) || typeof v !== 'string' || v.length > 1000)) throw invalid();
  return value as Record<string, string>;
}
