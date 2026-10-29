import type { Snapshot } from '@sportos/mcp';
/** A labelled projection of existing deterministic values; no new calculations. */
export function chatEvidence(tool: string, result: unknown): unknown {
  if (tool !== 'get_athlete_snapshot') return result;
  const snapshot = result as unknown as Snapshot;
  return {
    projection: {
      kind: 'sportos.chat-snapshot-summary.v1',
      omitted: ['longitudinal', 'annual', 'monthly', 'completeWeeks', 'runningBests', 'recentRunningBests', 'discipline distributions, metrics and benchmarks'],
      selectedActivityLimitPerList: 3,
      detail: 'Use training volume, personal bests, search and activity detail tools for focused evidence. Selected activities are examples, not exhaustive lists.',
    },
    schemaVersion: snapshot.schemaVersion, calculationVersion: snapshot.calculationVersion,
    generatedAt: snapshot.generatedAt, asOfDate: snapshot.asOfDate, timezone: snapshot.timezone,
    completeThrough: snapshot.completeThrough, sourcePolicy: snapshot.sourcePolicy,
    units: snapshot.units, coverage: snapshot.coverage,
    disciplines: Object.fromEntries(Object.entries(snapshot.disciplines).map(([sport, d]) => [sport, {
      lifetime: d.lifetime, windows: d.windows,
      longest: d.longest.slice(0, 3), recent: d.recent.slice(0, 3), recentLongest: d.recentLongest.slice(0, 3),
    }])),
    adjacentComparisons: snapshot.longitudinal ? Object.fromEntries(Object.entries(snapshot.longitudinal.profiles).map(([sport, profile]) => [sport, profile.adjacentComparisons])) : {},
    knownUnknowns: snapshot.knownUnknowns, limitations: snapshot.limitations,
  };
}
