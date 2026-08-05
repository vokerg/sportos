export type AnalysisToolName = 'daily_summary' | 'daily_score_breakdown';

export interface DailySummaryToolRequest {
  tool: 'daily_summary';
  input: {
    from: string;
    to: string;
    limit: number;
  };
}

export interface DailyScoreBreakdownToolRequest {
  tool: 'daily_score_breakdown';
  input: {
    date: string;
  };
}

export type AnalysisToolRequest = DailySummaryToolRequest | DailyScoreBreakdownToolRequest;

export type AnalysisCitationKind =
  | 'daily_metric'
  | 'source_record'
  | 'import_batch'
  | 'score_ledger'
  | 'scoring_rule'
  | 'activity';

export interface AnalysisCitation {
  key: string;
  kind: AnalysisCitationKind;
  id?: string;
  date?: string;
  label: string;
}

export type AnalysisDataQualityFlag =
  | 'NO_DATA'
  | 'RANGE_EXCEEDS_RESULT_LIMIT'
  | 'OFFICIAL_SCORE_CONFLICT'
  | 'SOURCE_PROVENANCE_MISSING'
  | 'SOURCE_PROVENANCE_UNSUPPORTED'
  | 'RULE_REFERENCE_MISSING';

export interface AnalysisDataQuality {
  status: 'complete' | 'partial' | 'missing' | 'conflicting';
  flags: AnalysisDataQualityFlag[];
}

export interface AnalysisToolEnvelope<TFacts> {
  tool: AnalysisToolName;
  readOnly: true;
  authority: 'official_sportos_record';
  generatedText: false;
  facts: TFacts;
  citations: AnalysisCitation[];
  dataQuality: AnalysisDataQuality;
  safety: {
    databaseWrites: false;
    arbitraryStoredTextExcluded: true;
    instructionsFromStoredDataAccepted: false;
  };
}

export interface DailySummaryFact {
  date: string;
  recomputedAt: string;
  metrics: {
    steps: number;
    runM: number;
    bikeM: number;
    swimM: number;
    workoutPoints: number;
    powerPoints: number;
  };
  score: {
    officialTotal: number;
    baseTotal: number;
    bonusTotal: number;
    excelTotal: number | null;
    deltaVsExcel: number | null;
  };
  rollingAverage: {
    days10: number | null;
    days20: number | null;
    days30: number | null;
    days60: number | null;
    days365: number | null;
  };
}

export interface DailySummaryFacts {
  range: { from: string; to: string };
  days: DailySummaryFact[];
}

export interface AnalysisSourceReference {
  sourceRecordId: string;
  importBatchId: string;
  source: string;
}

export interface DailyScoreBreakdownFacts {
  date: string;
  recomputedAt: string;
  metrics: {
    steps: number;
    runM: number;
    bikeM: number;
    swimM: number;
    workoutPoints: number;
    powerPoints: number;
  };
  score: {
    appTotal: number;
    excelTotal: number | null;
    delta: number | null;
    baseTotal: number;
    bonusTotal: number;
    ledgerTotal: number;
  };
  source: AnalysisSourceReference | null;
  ledger: Array<{
    id: string;
    points: number;
    reason: string;
    calculation: unknown;
    rule: null | {
      id: string;
      activityType: string;
      ruleKind: string;
      coefficient: number | null;
      thresholdOperator: string | null;
      thresholdValue: number | null;
      configuredPoints: number | null;
      validFrom: string;
      validTo: string | null;
      priority: number;
    };
    activity: null | {
      id: string;
      source: string;
      activityDate: string;
      activityType: string;
      subtype: string | null;
      distanceM: number | null;
      durationS: number | null;
      movingTimeS: number | null;
      steps: number | null;
      effortPoints: number | null;
      sourceRecord: AnalysisSourceReference | null;
    };
  }>;
}
