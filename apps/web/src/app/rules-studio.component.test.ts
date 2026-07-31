import '@angular/compiler';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiService, RuleChange, RulePreviewResponse, RuleVersion } from './api.service';
import { RulesStudioComponent } from './rules-studio.component';

const rule: RuleVersion = {
  id: '11111111-1111-4111-8111-111111111111',
  version: 1,
  supersedesRuleId: null,
  code: 'run.km.default',
  name: 'Run coefficient',
  activityType: 'run',
  ruleKind: 'coefficient',
  metric: 'distance_km',
  coefficient: 1000,
  validFrom: '1900-01-01',
  priority: 20,
  enabled: true,
  description: 'Current rule.',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const preview: RulePreviewResponse = {
  proposal: {
    replaceRuleId: rule.id,
    code: rule.code,
    name: 'Run coefficient v2',
    activityType: 'run',
    ruleKind: 'coefficient',
    metric: 'distance_km',
    coefficient: 1200,
    validFrom: '2026-05-18',
    priority: 20,
  },
  preview: {
    affectedFrom: '2026-05-18',
    affectedTo: '2026-05-18',
    totalDates: 1,
    changedDates: 1,
    aggregateDelta: 1000,
    minimumDelta: 1000,
    maximumDelta: 1000,
    rows: [{
      metricDate: '2026-05-18',
      currentBasePoints: 5000,
      proposedBasePoints: 6000,
      currentBonusPoints: 0,
      proposedBonusPoints: 0,
      currentTotalPoints: 5000,
      proposedTotalPoints: 6000,
      delta: 1000,
    }],
  },
  previewFingerprint: 'a'.repeat(64),
};

const queuedChange: RuleChange = {
  id: '22222222-2222-4222-8222-222222222222',
  ruleCode: rule.code,
  previousRuleId: rule.id,
  proposedRuleId: '33333333-3333-4333-8333-333333333333',
  status: 'queued',
  phase: 'queued',
  progressPercent: 0,
  attemptCount: 0,
  maxAttempts: 3,
  cancellationRequested: false,
  initiatedBy: 'local-user',
  reason: 'Increase coefficient.',
  proposal: preview.proposal,
  preview: preview.preview,
  previewFingerprint: preview.previewFingerprint,
  affectedFrom: '2026-05-18',
  affectedTo: '2026-05-18',
  error: null,
  result: {},
  createdAt: '2026-07-31T08:00:00.000Z',
  updatedAt: '2026-07-31T08:00:00.000Z',
  startedAt: null,
  completedAt: null,
};

const succeededChange: RuleChange = {
  ...queuedChange,
  status: 'succeeded',
  phase: 'completed',
  progressPercent: 100,
  attemptCount: 1,
  result: { datesRecomputed: 1, proposedRuleId: queuedChange.proposedRuleId },
  startedAt: '2026-07-31T08:00:01.000Z',
  completedAt: '2026-07-31T08:00:02.000Z',
};

afterEach(() => vi.useRealTimers());

describe('RulesStudioComponent', () => {
  it('loads immutable rule versions and audit history', () => {
    const api = createApi();
    const component = new RulesStudioComponent(api as unknown as ApiService);

    component.ngOnInit();

    expect(api.ruleVersions).toHaveBeenCalled();
    expect(api.ruleChanges).toHaveBeenCalled();
    expect(component.rules()).toEqual([rule]);
    expect(component.changes()).toEqual([queuedChange]);
  });

  it('prepares a superseding version and renders a server-computed preview', () => {
    const api = createApi();
    const component = new RulesStudioComponent(api as unknown as ApiService);

    component.editRule(rule);
    component.proposal.validFrom = '2026-05-18';
    component.proposal.name = 'Run coefficient v2';
    component.proposal.coefficient = 1200;
    component.preview();

    expect(api.previewRule).toHaveBeenCalledWith(expect.objectContaining({
      replaceRuleId: rule.id,
      code: rule.code,
      coefficient: 1200,
      validFrom: '2026-05-18',
    }));
    expect(component.previewResult()).toEqual(preview);
    expect(component.message()).toContain('Preview complete');
  });

  it('queues activation and stops bounded polling at success', async () => {
    vi.useFakeTimers();
    const api = createApi();
    api.ruleChange.mockReturnValue(of(succeededChange));
    const component = new RulesStudioComponent(api as unknown as ApiService);
    component.previewResult.set(preview);
    component.reason = 'Increase coefficient.';

    component.activate();
    await vi.runAllTimersAsync();

    expect(api.activateRule).toHaveBeenCalledWith(preview.proposal, preview.previewFingerprint, 'Increase coefficient.');
    expect(api.ruleChange).toHaveBeenCalledWith(queuedChange.id);
    expect(component.activeChange()?.status).toBe('succeeded');
    expect(component.message()).toContain('atomically');
  });

  it('supports cooperative cancellation and retry with the same audit identity', async () => {
    vi.useFakeTimers();
    const failed = {
      ...queuedChange,
      status: 'failed' as const,
      phase: 'failed',
      attemptCount: 1,
      error: { code: 'FORCED', message: 'sanitized failure' },
    };
    const api = createApi();
    api.cancelRuleChange.mockReturnValue(of({ ...queuedChange, status: 'cancelled' as const, phase: 'cancelled' }));
    api.retryRuleChange.mockReturnValue(of(queuedChange));
    api.ruleChange.mockReturnValue(of(succeededChange));
    const component = new RulesStudioComponent(api as unknown as ApiService);

    component.activeChange.set(queuedChange);
    component.cancelActiveChange();
    expect(api.cancelRuleChange).toHaveBeenCalledWith(queuedChange.id);
    expect(component.activeChange()?.status).toBe('cancelled');

    component.activeChange.set(failed);
    component.retryActiveChange();
    await vi.runAllTimersAsync();
    expect(api.retryRuleChange).toHaveBeenCalledWith(failed.id);
    expect(component.activeChange()?.id).toBe(failed.id);
    expect(component.activeChange()?.status).toBe('succeeded');
  });
});

function createApi() {
  return {
    ruleVersions: vi.fn().mockReturnValue(of([rule])),
    ruleChanges: vi.fn().mockReturnValue(of([queuedChange])),
    previewRule: vi.fn().mockReturnValue(of(preview)),
    activateRule: vi.fn().mockReturnValue(of(queuedChange)),
    ruleChange: vi.fn().mockReturnValue(of(succeededChange)),
    cancelRuleChange: vi.fn().mockReturnValue(of({ ...queuedChange, status: 'cancelled' as const, phase: 'cancelled' })),
    retryRuleChange: vi.fn().mockReturnValue(of(queuedChange)),
  };
}
