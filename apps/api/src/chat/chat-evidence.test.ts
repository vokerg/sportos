import { describe, expect, it } from 'vitest';
import { chatEvidence } from './chat-evidence.js';
describe('chat snapshot projection', () => {
  it('preserves deterministic values and caveats while declaring omitted detail', () => {
    const summary = { lifetime: { distanceM: 12345 }, windows: [{ days: 28, sessions: 2 }], longest: [1, 2, 3, 4], recent: [5, 6, 7, 8], recentLongest: [9, 10, 11, 12], metrics: [{ sensitiveSentinel: 'not-in-this-projection' }] };
    const original = { schemaVersion: 'sportos.athlete-snapshot.v1', units: { distance: 'm' }, sourcePolicy: { narrative: 'excluded' }, coverage: { archiveCompleteness: 'unknown' }, disciplines: { run: summary, bike: summary, swim: summary }, longitudinal: { profiles: { run: { adjacentComparisons: [{ days: 28, distanceChangePercent: 12 }] }, bike: { adjacentComparisons: [] }, swim: { adjacentComparisons: [] } }, large: 'x'.repeat(200000) }, knownUnknowns: ['No power'], limitations: ['Retained only'] };
    const result = chatEvidence('get_athlete_snapshot', original) as { disciplines: typeof original.disciplines; projection: { omitted: string[] } };
    expect(result.disciplines.run.lifetime).toEqual(original.disciplines.run.lifetime);
    expect(result.disciplines.run.windows).toEqual(original.disciplines.run.windows);
    expect(result.disciplines.run.longest).toEqual([1, 2, 3]);
    expect(result.projection.omitted).toContain('longitudinal');
    expect(result).toMatchObject({ adjacentComparisons: { run: original.longitudinal.profiles.run.adjacentComparisons } });
    expect(result).toMatchObject({ units: original.units, coverage: original.coverage, limitations: original.limitations });
    expect(JSON.stringify(result)).not.toContain('sensitiveSentinel');
    expect(JSON.stringify(result).length).toBeLessThan(120000);
    expect(original.disciplines.run.longest).toHaveLength(4);
  });
  it('leaves focused official tool results intact', () => {
    const result = { totals: { sessions: 2 } };
    expect(chatEvidence('get_training_volume', result)).toBe(result);
  });
});
