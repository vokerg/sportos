import { HttpClient } from '@angular/common/http';
import { Inject, Injectable } from '@angular/core';
import { SPORTOS_API_BASE } from './core/config/api-base';

export type AnalysisToolName = 'daily_summary' | 'daily_score_breakdown';
export type AnalysisDataQualityStatus = 'complete' | 'partial' | 'missing' | 'conflicting';

export interface AnalysisCitation {
  key: string;
  kind: string;
  id?: string;
  date?: string;
  label: string;
}

export interface AnalysisToolRecord {
  tool: AnalysisToolName;
  readOnly: true;
  authority: 'official_sportos_record';
  generatedText: false;
  facts: unknown;
  citations: AnalysisCitation[];
  dataQuality: { status: AnalysisDataQualityStatus; flags: string[] };
}

export interface GeneratedAnalysisItem {
  text: string;
  citationKeys: string[];
}

export interface AnalysisAnswer {
  status: 'answered' | 'insufficient_data' | 'refused';
  readOnly: true;
  generatedGuidance: {
    generator: 'deterministic_fallback' | 'external_model';
    provider: string | null;
    model: string | null;
    observations: GeneratedAnalysisItem[];
    uncertainty: GeneratedAnalysisItem[];
    suggestions: GeneratedAnalysisItem[];
  };
  officialRecord: AnalysisToolRecord | null;
  auditId: string;
  limitations: {
    canModifyOfficialRecords: false;
    officialCalculationsAreDeterministic: true;
    generatedGuidanceIsAuthoritative: false;
  };
}

export type AnalysisAnswerRequest =
  | {
      question: string;
      tool: 'daily_summary';
      input: { from: string; to: string; limit: number };
    }
  | {
      question: string;
      tool: 'daily_score_breakdown';
      input: { date: string };
    };

@Injectable({ providedIn: 'root' })
export class AnalysisApiService {
  constructor(
    private readonly http: HttpClient,
    @Inject(SPORTOS_API_BASE) private readonly apiBase: string,
  ) {}

  answer(request: AnalysisAnswerRequest) {
    return this.http.post<AnalysisAnswer>(`${this.apiBase}/analysis/answers`, request);
  }
}
