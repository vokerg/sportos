import { Inject, Injectable } from '@nestjs/common';
import { LEGACY_ACCOUNT_ID } from '@sportos/db';
import { DailyService } from '../daily/daily.service.js';
import type {
  AnalysisCitation,
  AnalysisDataQualityFlag,
  AnalysisSourceReference,
  AnalysisToolEnvelope,
  AnalysisToolRequest,
  DailyScoreBreakdownFacts,
  DailyScoreBreakdownToolRequest,
  DailySummaryFacts,
  DailySummaryToolRequest,
} from './analysis.contracts.js';

@Injectable()
export class AnalysisService {
  constructor(@Inject(DailyService) private readonly dailyService: DailyService) {}

  execute(
    request: DailySummaryToolRequest,
    accountId?: string,
  ): Promise<AnalysisToolEnvelope<DailySummaryFacts>>;
  execute(
    request: DailyScoreBreakdownToolRequest,
    accountId?: string,
  ): Promise<AnalysisToolEnvelope<DailyScoreBreakdownFacts | null>>;
  execute(
    request: AnalysisToolRequest,
    accountId = LEGACY_ACCOUNT_ID,
  ): Promise<AnalysisToolEnvelope<DailySummaryFacts> | AnalysisToolEnvelope<DailyScoreBreakdownFacts | null>> {
    switch (request.tool) {
      case 'daily_summary':
        return this.dailySummary(request, accountId);
      case 'daily_score_breakdown':
        return this.dailyScoreBreakdown(request.input.date, accountId);
    }
  }

  private async dailySummary(
    request: DailySummaryToolRequest,
    accountId: string,
  ): Promise<AnalysisToolEnvelope<DailySummaryFacts>> {
    const rows = await this.dailyService.summary(request.input, accountId);
    const flags: AnalysisDataQualityFlag[] = [];
    if (rows.length === 0) flags.push('NO_DATA');
    if (inclusiveSpan(request.input.from, request.input.to) > request.input.limit) {
      flags.push('RANGE_EXCEEDS_RESULT_LIMIT');
    }

    return envelope('daily_summary', {
      range: { from: request.input.from, to: request.input.to },
      days: rows.map((row) => ({
        date: row.metric_date,
        recomputedAt: toIsoTimestamp(row.recomputed_at),
        metrics: {
          steps: Number(row.steps),
          runM: Number(row.run_m),
          bikeM: Number(row.bike_m),
          swimM: Number(row.swim_m),
          workoutPoints: Number(row.workout_points),
          powerPoints: Number(row.power_points),
        },
        score: {
          officialTotal: Number(row.total_points),
          baseTotal: Number(row.base_points),
          bonusTotal: Number(row.bonus_points),
          excelTotal: nullableNumber(row.excel_all_points),
          deltaVsExcel: nullableNumber(row.points_delta_vs_excel),
        },
        rollingAverage: {
          days10: nullableNumber(row.avg_10d),
          days20: nullableNumber(row.avg_20d),
          days30: nullableNumber(row.avg_30d),
          days60: nullableNumber(row.avg_60d),
          days365: nullableNumber(row.avg_365d),
        },
      })),
    }, rows.map((row) => ({
      key: `daily_metric:${row.metric_date}`,
      kind: 'daily_metric' as const,
      date: row.metric_date,
      label: `Official daily metric for ${row.metric_date}`,
    })), quality(flags));
  }

  private async dailyScoreBreakdown(
    date: string,
    accountId: string,
  ): Promise<AnalysisToolEnvelope<DailyScoreBreakdownFacts | null>> {
    const record = await this.dailyService.scoreBreakdown(date, accountId);
    if (record === null) {
      return envelope('daily_score_breakdown', null, [], { status: 'missing', flags: ['NO_DATA'] });
    }

    const flags = new Set<AnalysisDataQualityFlag>();
    if (record.score.delta !== null && record.score.delta !== 0) flags.add('OFFICIAL_SCORE_CONFLICT');
    if (record.sourceRecord === null) flags.add('SOURCE_PROVENANCE_MISSING');

    const citations = new Map<string, AnalysisCitation>();
    addCitation(citations, {
      key: `daily_metric:${record.date}`,
      kind: 'daily_metric',
      date: record.date,
      label: `Official daily metric for ${record.date}`,
    });
    addSourceCitations(citations, record.sourceRecord);

    const ledger = record.ledger.map((entry) => {
      addCitation(citations, {
        key: `score_ledger:${entry.id}`,
        kind: 'score_ledger',
        id: entry.id,
        date: record.date,
        label: 'Official score-ledger contribution',
      });

      if (entry.rule === null) {
        flags.add('RULE_REFERENCE_MISSING');
      } else {
        addCitation(citations, {
          key: `scoring_rule:${entry.rule.id}`,
          kind: 'scoring_rule',
          id: entry.rule.id,
          label: 'Exact scoring-rule version',
        });
      }

      if (entry.activity !== null) {
        addCitation(citations, {
          key: `activity:${entry.activity.id}`,
          kind: 'activity',
          id: entry.activity.id,
          date: entry.activity.activityDate,
          label: `Canonical activity on ${entry.activity.activityDate}`,
        });
        if (entry.activity.sourceRecord === null) {
          flags.add(entry.activity.source === 'manual'
            ? 'SOURCE_PROVENANCE_UNSUPPORTED'
            : 'SOURCE_PROVENANCE_MISSING');
        }
        addSourceCitations(citations, entry.activity.sourceRecord);
      }

      return {
        id: entry.id,
        points: entry.points,
        reason: entry.reason,
        calculation: entry.calculation,
        rule: entry.rule === null ? null : {
          id: entry.rule.id,
          activityType: entry.rule.activityType,
          ruleKind: entry.rule.ruleKind,
          coefficient: entry.rule.coefficient,
          thresholdOperator: entry.rule.thresholdOperator,
          thresholdValue: entry.rule.thresholdValue,
          configuredPoints: entry.rule.configuredPoints,
          validFrom: entry.rule.validFrom,
          validTo: entry.rule.validTo,
          priority: entry.rule.priority,
        },
        activity: entry.activity === null ? null : {
          id: entry.activity.id,
          source: entry.activity.source,
          activityDate: entry.activity.activityDate,
          activityType: entry.activity.activityType,
          subtype: entry.activity.subtype,
          distanceM: entry.activity.distanceM,
          durationS: entry.activity.durationS,
          movingTimeS: entry.activity.movingTimeS,
          steps: entry.activity.steps,
          effortPoints: entry.activity.effortPoints,
          sourceRecord: sanitizeSource(entry.activity.sourceRecord),
        },
      };
    });

    const flagList = [...flags];
    return envelope('daily_score_breakdown', {
      date: record.date,
      recomputedAt: record.recomputedAt,
      metrics: record.facts,
      score: record.score,
      source: sanitizeSource(record.sourceRecord),
      ledger,
    }, [...citations.values()], quality(flagList));
  }
}

function envelope<TFacts>(
  tool: AnalysisToolEnvelope<TFacts>['tool'],
  facts: TFacts,
  citations: AnalysisCitation[],
  dataQuality: AnalysisToolEnvelope<TFacts>['dataQuality'],
): AnalysisToolEnvelope<TFacts> {
  return {
    tool,
    readOnly: true,
    authority: 'official_sportos_record',
    generatedText: false,
    facts,
    citations,
    dataQuality,
    safety: {
      databaseWrites: false,
      untrustedNarrativeTextExcluded: true,
      instructionsFromStoredDataAccepted: false,
    },
  };
}

function quality(flags: AnalysisDataQualityFlag[]): AnalysisToolEnvelope<unknown>['dataQuality'] {
  if (flags.includes('NO_DATA')) return { status: 'missing', flags };
  if (flags.includes('OFFICIAL_SCORE_CONFLICT')) return { status: 'conflicting', flags };
  return { status: flags.length === 0 ? 'complete' : 'partial', flags };
}

function sanitizeSource(source: {
  id: string;
  batch: { id: string; source: string };
} | null): AnalysisSourceReference | null {
  if (source === null) return null;
  return {
    sourceRecordId: source.id,
    importBatchId: source.batch.id,
    source: source.batch.source,
  };
}

function addSourceCitations(
  citations: Map<string, AnalysisCitation>,
  source: { id: string; batch: { id: string } } | null,
): void {
  if (source === null) return;
  addCitation(citations, {
    key: `source_record:${source.id}`,
    kind: 'source_record',
    id: source.id,
    label: 'Canonical source-record provenance',
  });
  addCitation(citations, {
    key: `import_batch:${source.batch.id}`,
    kind: 'import_batch',
    id: source.batch.id,
    label: 'Import batch containing the source record',
  });
}

function addCitation(citations: Map<string, AnalysisCitation>, citation: AnalysisCitation): void {
  citations.set(citation.key, citation);
}

function nullableNumber(value: unknown): number | null {
  return value === null ? null : Number(value);
}

function toIsoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return new Date(value).toISOString();
  throw new TypeError('Expected a database timestamp value.');
}

function inclusiveSpan(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000) + 1;
}
