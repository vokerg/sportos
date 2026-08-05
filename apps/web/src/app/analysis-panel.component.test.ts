import '@angular/compiler';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { AnalysisAnswer, AnalysisApiService } from './analysis-api.service';
import { AnalysisPanelComponent } from './analysis-panel.component';

const answer: AnalysisAnswer = {
  status: 'answered',
  readOnly: true,
  generatedGuidance: {
    generator: 'deterministic_fallback',
    provider: null,
    model: null,
    observations: [{ text: 'The official total is 12 points.', citationKeys: ['daily_metric:2026-05-18'] }],
    uncertainty: [],
    suggestions: [{ text: 'Review the evidence.', citationKeys: [] }],
  },
  officialRecord: {
    tool: 'daily_summary',
    readOnly: true,
    authority: 'official_sportos_record',
    generatedText: false,
    facts: {},
    citations: [{ key: 'daily_metric:2026-05-18', kind: 'daily_metric', date: '2026-05-18', label: 'Official daily metric for 2026-05-18' }],
    dataQuality: { status: 'complete', flags: [] },
  },
  auditId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  limitations: {
    canModifyOfficialRecords: false,
    officialCalculationsAreDeterministic: true,
    generatedGuidanceIsAuthoritative: false,
  },
};

describe('AnalysisPanelComponent', () => {
  it('submits a bounded read-only range and exposes generated versus official evidence separately', () => {
    const api = { answer: vi.fn().mockReturnValue(of(answer)) };
    const component = new AnalysisPanelComponent(api as unknown as AnalysisApiService);
    component.from.set('2026-05-01');
    component.to.set('2026-05-31');
    component.question.set('What stands out?');
    component.analyze();
    expect(component.state()).toBe('ready');
    expect(component.result()?.generatedGuidance.observations[0]?.text).toContain('12 points');
    expect(component.result()?.officialRecord?.citations[0]?.key).toBe('daily_metric:2026-05-18');
    expect(component.generatorLabel(answer)).toBe('deterministic safe fallback');
    expect(api.answer).toHaveBeenCalledWith({
      question: 'What stands out?',
      tool: 'daily_summary',
      input: { from: '2026-05-01', to: '2026-05-31', limit: 366 },
    });
  });

  it('rejects reversed ranges without calling the API', () => {
    const api = { answer: vi.fn() };
    const component = new AnalysisPanelComponent(api as unknown as AnalysisApiService);
    component.from.set('2026-06-01');
    component.to.set('2026-05-01');
    component.analyze();
    expect(component.state()).toBe('error');
    expect(api.answer).not.toHaveBeenCalled();
  });
});
