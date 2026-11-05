import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { buildAthleteSnapshot } from '@sportos/analytics';
import type { ActivityDetailDbProvider, DbProvider } from '../db.provider.js';
import type { McpOAuthService } from './mcp-oauth.service.js';
import { McpHttpService } from './mcp-http.service.js';
const mocks = vi.hoisted(() => ({ owners: [] as string[], reads: vi.fn() }));
vi.mock('@sportos/mcp', async original => {
  const actual = await original<typeof import('@sportos/mcp')>();
  return { ...actual, assertRuntimeRole: vi.fn(), AthleteReadService: class {
    constructor(_db: unknown, owner: string) { mocks.owners.push(owner); }
    snapshot() { mocks.reads(); return buildAthleteSnapshot({ activities: [], supplements: [], runningBests: [], recentRunningBests: [],
      asOfDate: '2026-10-28', timezone: 'Europe/Copenhagen', generatedAt: '2026-10-28T12:00:00.000Z' }); }
  } };
});
let service: McpHttpService;
let account: string | null;
const origin = 'https://api.sportos.example';
const headers = { authorization: 'Bearer smc_' + 'a'.repeat(64), accept: 'application/json, text/event-stream', 'content-type': 'application/json' };
beforeEach(() => {
  mocks.owners.length = 0; mocks.reads.mockReset(); account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  service = new McpHttpService({ db: {} } as DbProvider, { db: {} } as ActivityDetailDbProvider,
    { config: () => ({ origin, resource: origin + '/mcp' }), authenticate: async () => account } as unknown as McpOAuthService);
});
afterEach(() => vi.restoreAllMocks());
describe('remote MCP stateless transport', () => {
  it('challenges unauthenticated clients before any server or data access', async () => {
    account = null;
    const result = await service.handle('POST', {}, { method: 'tools/list' });
    expect(result.status).toBe(401); expect(result.headers.get('www-authenticate')).toContain('/.well-known/oauth-protected-resource/mcp');
    expect(mocks.owners).toEqual([]); expect(mocks.reads).not.toHaveBeenCalled();
  });
  it('uses the actual HTTP SDK to initialize, discover, call and reject forbidden arguments/tools', async () => {
    const client = new Client({ name: 'fixture-http', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(origin + '/mcp'), {
      requestInit: { headers },
      fetch: async (input, init) => {
        const request = new Request(input, init);
        return service.handle(request.method, Object.fromEntries(request.headers), request.method === 'POST' ? await request.json() : undefined);
      },
    });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map(t => t.name).sort()).toEqual(['get_activity_details', 'get_athlete_snapshot', 'get_personal_bests', 'get_training_volume', 'search_activities']);
      expect(tools.every(t => t.annotations?.readOnlyHint && t.outputSchema)).toBe(true);
      expect((await client.callTool({ name: 'get_athlete_snapshot', arguments: {} })).structuredContent).toMatchObject({ schemaVersion: 'sportos.athlete-snapshot.v1' });
      expect(mocks.reads).toHaveBeenCalledTimes(1);
      expect((await client.callTool({ name: 'get_athlete_snapshot', arguments: { ownerId: 'foreign' } })).isError).toBe(true);
      await expect(client.callTool({ name: 'sync_provider', arguments: {} })).rejects.toThrow();
      expect(mocks.reads).toHaveBeenCalledTimes(1);
      const first = account; account = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      await client.callTool({ name: 'get_athlete_snapshot', arguments: {} });
      expect(mocks.owners).toContain(first); expect(mocks.owners.at(-1)).toBe(account);
      account = null;
      // Directly check a previously initialized transport cannot bypass reauthentication.
      expect((await service.handle('POST', headers, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).status).toBe(401);
    } finally { await client.close(); }
  });
  it('bounds bodies, denies subscriptions, and limits requests across fresh server instances', async () => {
    expect((await service.handle('POST', headers, { padding: 'x'.repeat(66000) })).status).toBe(413);
    expect((await service.handle('GET', headers)).status).toBe(405);
    expect((await service.handle('DELETE', headers)).status).toBe(405);
    for (let i = 0; i < 30; i++) await service.handle('POST', headers, { jsonrpc: '2.0', id: i, method: 'ping' });
    await expect(service.handle('POST', headers, { jsonrpc: '2.0', id: 31, method: 'ping' })).rejects.toMatchObject({ status: 429 });
  });
});
