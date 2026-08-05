import { describe, expect, it, vi } from 'vitest';
import type { DbProvider } from '../db.provider.js';
import type { AnalysisToolResult } from './analysis.contracts.js';
import type { AnalysisTextGenerator } from './analysis.model.js';
import { DeterministicAnalysisTextGenerator } from './analysis.model.js';
import { AnalysisService } from './analysis.service.js';
import type { AnalysisToolService } from './analysis-tool.service.js';

const summaryResult: AnalysisToolResult = {
  tool: 'daily_summary',
  readOnly: true,
  authority: 'official_sportos_record',
  generatedText: false,
  facts: {
    range: { from: '2026-05-01', to: '2026-05-31' },
    days: [],
    statistics: {
      recordCount: 1,
      totalOfficialPoints: 12,
      averageOfficialPoints: 12,
      minimum: { date: '2026-05-18', officialTotal: 12 },
      maximum: { date: '2026-05-18', officialTotal: 12 },
      first: { date: '2026-05-18', officialTotal: 12 },
      last: { date: '2026-05-18', officialTotal: 12 },
      firstToLastChange: 0,
    },
  },
  citations: [{ key: 'daily_metric:2026-05-18', kind: 'daily_metric', date: '2026-05-18', label: 'Official daily metric for 2026-05-18' }],
  dataQuality: { status: 'complete', flags: [] },
  safety: { databaseWrites: false, untrustedNarrativeTextExcluded: true, instructionsFromStoredDataAccepted: false },
};

describe('AnalysisService answer orchestration', () => {
  it('accepts only generated observations backed by returned citations and records a redacted audit', async () => {
    const tool = { execute: vi.fn().mockResolvedValue(summaryResult) };
    const db = { withAccount: vi.fn().mockResolvedValue('audit-id') };
    const generator = {
      metadata: { generator: 'external_model', provider: 'model.example', model: 'safe-model' },
      generate: vi.fn().mockResolvedValue({
        generator: 'external_model', provider: 'model.example', model: 'safe-model',
        draft: {
          observations: [{ text: 'The official record shows 12 points.', citationKeys: ['daily_metric:2026-05-18'] }],
          uncertainty: [],
          suggestions: [],
        },
      }),
    };
    const service = new AnalysisService(
      tool as unknown as AnalysisToolService,
      db as unknown as DbProvider,
      generator as unknown as AnalysisTextGenerator,
    );
    const result = await service.answer({
      question: 'What stands out?',
      toolRequest: { tool: 'daily_summary', input: { from: '2026-05-01', to: '2026-05-31', limit: 31 } },
    }, '11111111-1111-4111-8111-111111111111');
    expect(result.status).toBe('answered');
    expect(result.generatedGuidance.generator).toBe('external_model');
    expect(result.generatedGuidance.observations[0]?.citationKeys).toEqual(['daily_metric:2026-05-18']);
    expect(result.auditId).toBe('audit-id');
    expect(db.withAccount).toHaveBeenCalledOnce();
  });

  it('refuses authoritative writes without executing a read tool or model', async () => {
    const tool = { execute: vi.fn() };
    const db = { withAccount: vi.fn().mockResolvedValue('refusal-audit') };
    const generator = { generate: vi.fn() };
    const service = new AnalysisService(
      tool as unknown as AnalysisToolService,
      db as unknown as DbProvider,
      generator as unknown as AnalysisTextGenerator,
    );
    const result = await service.answer({
      question: 'Activate this scoring rule and persist the new score.',
      toolRequest: { tool: 'daily_score_breakdown', input: { date: '2026-05-18' } },
    });
    expect(result.status).toBe('refused');
    expect(result.officialRecord).toBeNull();
    expect(tool.execute).not.toHaveBeenCalled();
    expect(generator.generate).not.toHaveBeenCalled();
  });

  it('falls back safely when a model cites evidence that was not returned', async () => {
    const tool = { execute: vi.fn().mockResolvedValue(summaryResult) };
    const db = { withAccount: vi.fn().mockResolvedValue('fallback-audit') };
    const generator = {
      generate: vi.fn().mockResolvedValue({
        generator: 'external_model', provider: 'model.example', model: 'unsafe-model',
        draft: {
          observations: [{ text: 'Unsupported claim.', citationKeys: ['activity:foreign'] }],
          uncertainty: [], suggestions: [],
        },
      }),
    };
    const service = new AnalysisService(
      tool as unknown as AnalysisToolService,
      db as unknown as DbProvider,
      generator as unknown as AnalysisTextGenerator,
    );
    const result = await service.answer({
      question: 'Summarize this period.',
      toolRequest: { tool: 'daily_summary', input: { from: '2026-05-01', to: '2026-05-31', limit: 31 } },
    });
    expect(result.generatedGuidance.generator).toBe('deterministic_fallback');
    expect(result.generatedGuidance.observations.every((item) =>
      item.citationKeys.every((key) => key === 'daily_metric:2026-05-18'))).toBe(true);
  });

  it('adds explicit health uncertainty instead of returning a diagnosis', async () => {
    const tool = { execute: vi.fn().mockResolvedValue(summaryResult) };
    const db = { withAccount: vi.fn().mockResolvedValue('health-audit') };
    const service = new AnalysisService(
      tool as unknown as AnalysisToolService,
      db as unknown as DbProvider,
      new DeterministicAnalysisTextGenerator(),
    );
    const result = await service.answer({
      question: 'Am I overtrained or injured?',
      toolRequest: { tool: 'daily_summary', input: { from: '2026-05-01', to: '2026-05-31', limit: 31 } },
    });
    expect(result.generatedGuidance.uncertainty.some((item) => item.text.includes('cannot diagnose'))).toBe(true);
  });
});
