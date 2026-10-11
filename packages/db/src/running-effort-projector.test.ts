import { describe, expect, it } from 'vitest';
import { completeResources } from './running-effort-projector.js';
import { validateMetricBackfillOptions } from './activity-metric-backfill.js';
const expected = ['detail','sets','records'].map(resourceType => ({ resourceType, chunkIndex: 0 }));
const chunks = expected.map(e => ({ resource_type: e.resourceType, chunk_index: e.chunkIndex }));
describe('bounded retained effort inspection', () => {
  it('requires all declared chunks and consecutive record coverage', () => {
    expect(completeResources(expected, chunks)).toBe(true);
    expect(completeResources(expected, chunks.slice(0, 2))).toBe(false);
    expect(completeResources([...expected, expected[0]], chunks)).toBe(false);
    expect(completeResources(expected, [...chunks, { resource_type: 'records', chunk_index: 2 }])).toBe(false);
    expect(completeResources([], chunks)).toBe(false); expect(completeResources(null, chunks)).toBe(false);
  });
  it('validates cursor, batch, dry run and retry bounds before queries', () => {
    for (const options of [{ limit: 101, dryRun: true }, { limit: 0, dryRun: false }, { limit: 1, dryRun: true, cursor: 'bad' }, { limit: 1, dryRun: true, retries: 3 }]) expect(() => validateMetricBackfillOptions(options)).toThrow();
  });
});
