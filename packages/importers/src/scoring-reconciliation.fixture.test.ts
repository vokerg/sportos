import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reconcileScores, type ScoreReconciliationSummary, type ScoringRule } from '@sportos/domain';
import { describe, expect, it } from 'vitest';
import { parseMySportWorkbook } from './my-sport.importer.js';
import { writeMySportFixture } from './test-fixtures/xlsx-fixtures.js';
import { readWorkbook } from './xlsx-reader.js';

const rules: ScoringRule[] = [
  { code: 'steps.base', name: 'Steps', activityType: 'steps', ruleKind: 'coefficient', metric: 'steps', coefficient: 1, validFrom: '1900-01-01', priority: 10, enabled: true },
  { code: 'run.km.default', name: 'Run', activityType: 'run', ruleKind: 'coefficient', metric: 'distance_km', coefficient: 1000, validFrom: '1900-01-01', priority: 20, enabled: true },
  { code: 'bike.km.default', name: 'Bike', activityType: 'bike', ruleKind: 'coefficient', metric: 'distance_km', coefficient: 650, validFrom: '1900-01-01', priority: 30, enabled: true },
  { code: 'swim.m.default', name: 'Swim', activityType: 'swim', ruleKind: 'coefficient', metric: 'distance_m', coefficient: 7.5, validFrom: '1900-01-01', priority: 40, enabled: true },
  { code: 'workout.manual', name: 'Workout', activityType: 'workout', ruleKind: 'manual_points', metric: 'effort_points', coefficient: 1, validFrom: '1900-01-01', priority: 50, enabled: true },
  { code: 'power.manual', name: 'Power', activityType: 'power_bonus', ruleKind: 'manual_points', metric: 'effort_points', coefficient: 1, validFrom: '1900-01-01', priority: 60, enabled: true },
  { code: 'run.5k.sub25.bonus', name: '5k under 25', activityType: 'run', ruleKind: 'achievement', metric: 'duration_s', thresholdOperator: 'lt', thresholdValue: 1500, thresholdUnit: 's', points: 1000, validFrom: '1900-01-01', priority: 70, enabled: true },
  { code: 'run.10k.completed.bonus', name: '10k completed', activityType: 'run', ruleKind: 'achievement', metric: 'distance_m', thresholdOperator: 'gte', thresholdValue: 10000, thresholdUnit: 'm', points: 2000, validFrom: '1900-01-01', priority: 80, enabled: true },
  { code: 'swim.1k.sub20.bonus', name: '1km swim under 20', activityType: 'swim', ruleKind: 'achievement', metric: 'duration_s', thresholdOperator: 'lt', thresholdValue: 1200, thresholdUnit: 's', points: 1000, validFrom: '1900-01-01', priority: 90, enabled: true },
  { code: 'bike.10k.easy.bonus', name: 'Easy bike', activityType: 'bike', ruleKind: 'achievement', metric: 'avg_speed_kmh', thresholdOperator: 'lt', thresholdValue: 20, thresholdUnit: 'kmh', points: 1000, validFrom: '1900-01-01', priority: 100, enabled: true },
];

describe('fixture scoring reconciliation evidence', () => {
  it('matches the committed machine-readable exact/explained/unresolved summary', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sportos-scoring-reconciliation-'));

    try {
      const workbookPath = join(directory, 'my-sport.xlsx');
      writeMySportFixture(workbookPath);
      const parsed = parseMySportWorkbook(readWorkbook(workbookPath));
      const exactFacts = parsed.dailyMetrics[0]!;
      const noExcelFacts = parsed.dailyMetrics[1]!;
      const exactEvidence = parsed.scoreEvidence[0]!;
      const summary = reconcileScores([
        {
          facts: exactFacts,
          activities: parsed.activities,
          rules,
          sourceComponents: exactEvidence.components,
        },
        {
          facts: noExcelFacts,
          activities: parsed.activities,
          rules,
        },
        {
          facts: { metricDate: '2026-05-20', steps: 1000, runM: 5000, bikeM: 0, swimM: 0, workoutPoints: 0, powerPoints: 0, excelAllPoints: 6000 },
          activities: [{ activityDate: '2026-05-20', activityType: 'run', distanceM: 5000, durationS: 1499 }],
          rules,
        },
        {
          facts: { metricDate: '2026-05-21', steps: 0, runM: 0, bikeM: 1000, swimM: 0, workoutPoints: 0, powerPoints: 0, excelAllPoints: 700 },
          activities: [],
          rules,
          sourceComponents: [{ activityType: 'bike', sourceColumn: 'bike_to_s', importedPoints: 700 }],
        },
      ]);

      const evidencePath = new URL('../../../docs/evidence/scoring-reconciliation.fixture.json', import.meta.url);
      const committedEvidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as unknown;
      expect(compactSummary(summary)).toEqual(committedEvidence);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function compactSummary(summary: ScoreReconciliationSummary) {
  return {
    policy: summary.policy,
    counts: summary.counts,
    rows: summary.rows.map((row) => ({
      date: row.date,
      appTotal: row.appTotal,
      excelTotal: row.excelTotal,
      delta: row.delta,
      absoluteDelta: row.absoluteDelta,
      tolerance: row.tolerance,
      status: row.status,
      explanationCode: row.explanationCode,
      likelyRuleCodes: row.likelyRuleCodes,
      activityTypes: row.activityTypes,
      componentResults: row.componentResults,
    })),
    groups: summary.groups,
  };
}
