import { describe, it, expect } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './server.js';
import { AthleteReadService } from './service.js';
import { buildAthleteSnapshot } from '@sportos/analytics';
import { athleteSnapshotSchema } from './contracts.js';
const snapshot = () =>
  athleteSnapshotSchema.parse(
    buildAthleteSnapshot({
      activities: [],
      supplements: [],
      runningBests: [],
      recentRunningBests: [],
      asOfDate: '2026-10-28',
      timezone: 'Europe/Copenhagen',
      generatedAt: '2026-10-28T12:00:00.000Z',
    }),
  );
describe('generic MCP client compatibility', () => {
  it('discovers exactly five read-only tools and validates schemas and forbidden calls', async () => {
    let calls = 0;
    const service = {
      snapshot: async () => {
        calls++;
        return snapshot();
      },
    } as unknown as AthleteReadService;
    const server = createServer(service);
    const client = new Client({ name: 'synthetic-test', version: '1.0.0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(a);
      await client.connect(b);
      const result = await client.listTools();
      expect(result.tools.map((t) => t.name).sort()).toEqual([
        'get_activity_details',
        'get_athlete_snapshot',
        'get_personal_bests',
        'get_training_volume',
        'search_activities',
      ]);
      expect(result.tools.every((t) => t.annotations?.readOnlyHint && t.outputSchema)).toBe(true);
      const good = await client.callTool({ name: 'get_athlete_snapshot', arguments: {} });
      expect(good.isError).not.toBe(true);
      expect(good.structuredContent).toMatchObject({
        schemaVersion: 'sportos.athlete-snapshot.v1',
      });
      expect(calls).toBe(1);
      const bad = await client.callTool({
        name: 'get_athlete_snapshot',
        arguments: { ownerId: 'remote-selected-owner' },
      });
      expect(bad.isError).toBe(true);
      expect(calls).toBe(1);
      await expect(client.callTool({ name: 'sync_provider', arguments: {} })).rejects.toThrow(
        'not found',
      );
    } finally {
      await client.close();
      await server.close();
    }
  });
  it('redacts database errors and prevents concurrent reads', async () => {
    let finish: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const service = {
      snapshot: async () => {
        await pending;
        throw Error('credential and athlete details must never escape');
      },
    } as unknown as AthleteReadService;
    const server = createServer(service),
      client = new Client({ name: 'test', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(a);
      await client.connect(b);
      const first = client.callTool({ name: 'get_athlete_snapshot', arguments: {} });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const second = await client.callTool({ name: 'get_athlete_snapshot', arguments: {} });
      expect(second.structuredContent).toMatchObject({ error: { code: 'BUSY' } });
      finish();
      const failure = await first;
      expect(JSON.stringify(failure)).not.toContain('credential and athlete');
      expect(failure.structuredContent).toMatchObject({ error: { code: 'UNAVAILABLE' } });
    } finally {
      finish();
      await client.close();
      await server.close();
    }
  });
});
