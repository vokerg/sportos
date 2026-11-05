import { HttpException, Injectable } from '@nestjs/common';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { AthleteReadService, assertRuntimeRole, createServer } from '@sportos/mcp';
import { ActivityDetailDbProvider, DbProvider } from '../db.provider.js';
import { McpOAuthService } from './mcp-oauth.service.js';

@Injectable()
export class McpHttpService {
  private readonly active = new Set<string>();
  private readonly recent = new Map<string, { count: number; until: number }>();
  constructor(private readonly db: DbProvider, private readonly detail: ActivityDetailDbProvider,
    private readonly oauth: McpOAuthService) {}

  async handle(method: string, headers: Record<string, string | string[] | undefined>, body?: unknown): Promise<Response> {
    const c = this.oauth.config();
    const accountId = await this.oauth.authenticate(headers);
    if (!accountId) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401,
      headers: { 'content-type': 'application/json', 'www-authenticate': `Bearer resource_metadata="${c.origin}/.well-known/oauth-protected-resource/mcp", scope="athlete:read"` } });
    // Stateless request/response only: no SSE GET subscriptions or sessions to delete.
    if (method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
    const text = JSON.stringify(body);
    if (!text || Buffer.byteLength(text) > 65536) return new Response(null, { status: 413 });
    const now = Date.now();
    for (const [id, value] of this.recent) if (value.until <= now) this.recent.delete(id);
    const recent = this.recent.get(accountId) ?? { count: 0, until: now + 60_000 };
    if (this.active.has(accountId) || this.active.size >= 20 || recent.count >= 30) {
      throw new HttpException('SportOS reads are busy. Retry shortly.', 429);
    }
    this.recent.set(accountId, { ...recent, count: recent.count + 1 });
    this.active.add(accountId);
    const server = createServer(new AthleteReadService(this.db.db, accountId, 'Europe/Copenhagen', () => new Date(), this.detail.db));
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true, maxRequestBodySize: 65536 });
    try {
      await assertRuntimeRole(this.db.db);
      await server.connect(transport);
      const safeHeaders = new Headers();
      for (const name of ['accept', 'content-type', 'mcp-protocol-version']) {
        const value = headers[name];
        if (typeof value === 'string') safeHeaders.set(name, value);
      }
      const response = await transport.handleRequest(new Request(c.resource, { method, headers: safeHeaders, body: text }));
      // Consume JSON before closing the per-request transport; never retain tool results.
      return new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers });
    } finally {
      this.active.delete(accountId);
      await server.close();
    }
  }
}
