import '@angular/compiler';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiService, RuleChange, RulePreviewResponse, RuleVersion } from './api.service';
import { RulesStudioComponent } from './rules-studio.component';

const coefficientRule: RuleVersion = {
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

const achievementRule: RuleVersion = {
  id: '44444444-4444-4444-8444-444444444444',
  version: 3,
  supersedesRuleId: '55555555-5555-4555-8555-555555555555',
  code: 'run.pace.fast',
  name: 'Fast run pace',
  activityType: 'run',
  ruleKind: 'achievement',
  metric: 'pace_s_per_km',
  thresholdOperator: 'lt',
  thresholdValue: 240,
  thresholdUnit: 's/km',
  points: 4000,
  achievementGroup: 'run.pace.universal',
  pointsMultiplier: 'completed_5k_blocks',
  validFrom: '2026-05-01',
  priority: 40,
  enabled: true,
  description: 'Current pace tier.',
  createdAt: '2026-05-01T00:00:00.000Z',
};

const coefficientPreview: RulePreviewResponse = {
  proposal: {
    replaceRuleId: coefficientRule.id,
    code: coefficientRule.code,
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

const achievementPreview: RulePreviewResponse = {
  proposal: {
    replaceRuleId: achievementRule.id,
    code: achievementRule.code,
    name: 'Fast run pace v4',
    activityType: 'run',
    ruleKind: 'achievement',
    metric: 'pace_s_per_km',
    thresholdOperator: 'lt',
    thresholdValue: 235,
    thresholdUnit: 's/km',
    points: 4500,
    achievementGroup: 'run.pace.universal',
    pointsMultiplier: 'completed_5k_blocks',
    validFrom: '2026-06-01',
    priority: 40,
  },
  preview: {
    affectedFrom: '2026-06-01',
    affectedTo: '2026-06-30',
    totalDates: 30,
    changedDates: 2,
    aggregateDelta: 9000,
    minimumDelta: 0,
    maximumDelta: 4500,
    rows: [{
      metricDate: '2026-06-14',
      currentBasePoints: 6000,
      proposedBasePoints: 6000,
      currentBonusPoints: 0,
      proposedBonusPoints: 4500,
      currentTotalPoints: 6000,
      proposedTotalPoints: 10500,
      delta: 4500,
    }],
  },
  previewFingerprint: 'b'.repeat(64),
};

const queuedChange: RuleChange = {
  id: '22222222-2222-4222-8222-222222222222',
  ruleCode: coefficientRule.code,
  previousRuleId: coefficientRule.id,
  proposedRuleId: '33333333-3333-4333-8333-333333333333',
  status: 'queued',
  phase: 'queued',
  progressPercent: 0,
  attemptCount: 0,
  maxAttempts: 3,
  cancellationRequested: false,
  initiatedBy: 'local-user',
  reason: 'Increase coefficient.',
  proposal: coefficientPreview.proposal,
  preview: coefficientPreview.preview,
  previewFingerprint: coefficientPreview.previewFingerprint,
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

const failedChange: RuleChange = {
  ...queuedChange,
  status: 'failed',
  phase: 'failed',
  attemptCount: 1,
  error: { code: 'FORCED', message: 'sanitized failure' },
};

afterEach(() => vi.useRealTimers());

describe('RulesStudioComponent', () => {
  it('loads immutable rule versions and audit history', () => {
    const api = createApi();
    const component = new RulesStudioComponent(api as unknown as ApiService);

    component.ngOnInit();

    expect(api.ruleVersions).toHaveBeenCalled();
    expect(api.ruleChanges).toHaveBeenCalled();
    expect(component.rules()).toEqual([coefficientRule, achievementRule]);
    expect(component.changes()).toEqual([queuedChange]);
  });

  it('prepares a representative coefficient supersession and renders the server-computed preview', () => {
    const api = createApi();
    const component = new RulesStudioComponent(api as unknown as ApiService);

    component.editRule(coefficientRule);
    component.proposal.validFrom = '2026-05-18';
    component.proposal.name = 'Run coefficient v2';
    component.proposal.coefficient = 1200;
    component.preview();

    expect(api.previewRule).toHaveBeenCalledWith(expect.objectContaining({
      replaceRuleId: coefficientRule.id,
      code: coefficientRule.code,
      ruleKind: 'coefficient',
      coefficient: 1200,
      validFrom: '2026-05-18',
    }));
    expect(component.previewResult()).toEqual(coefficientPreview);
    expect(component.message()).toContain('Preview complete');
  });

  it('prepares a representative achievement supersession without calculating score impact in Angular', () => {
    const api = createApi();
    api.previewRule.mockReturnValue(of(achievementPreview));
    const component = new RulesStudioComponent(api as unknown as ApiService);

    component.editRule(achievementRule);
    component.proposal.validFrom = '2026-06-01';
    component.proposal.name = 'Fast run pace v4';
    component.proposal.thresholdValue = 235;
    component.proposal.points = 4500;
    component.preview();

    expect(api.previewRule).toHaveBeenCalledWith(expect.objectContaining({
      replaceRuleId: achievementRule.id,
      code: achievementRule.code,
      ruleKind: 'achievement',
      metric: 'pace_s_per_km',
      thresholdOperator: 'lt',
      thresholdValue: 235,
      thresholdUnit: 's/km',
      points: 4500,
      pointsMultiplier: 'completed_5k_blocks',
    }));
    expect(component.previewResult()).toEqual(achievementPreview);
    expect(component.previewResult()?.preview.aggregateDelta).toBe(9000);
  });

  it('keeps a queued change active until bounded polling reaches success', async () => {
    vi.useFakeTimers();
    const api = createApi();
    api.ruleChange.mockReturnValue(of(succeededChange));
    const component = new RulesStudioComponent(api as unknown as ApiService);
    component.previewResult.set(coefficientPreview);
    component.reason = 'Increase coefficient.';

    component.activate();

    expect(api.activateRule).toHaveBeenCalledWith(
      coefficientPreview.proposal,
      coefficientPreview.previewFingerprint,
      'Increase coefficient.',
    );
    expect(component.activeChange()?.status).toBe('queued');

    await vi.runAllTimersAsync();

    expect(api.ruleChange).toHaveBeenCalledWith(queuedChange.id);
    expect(component.activeChange()?.status).toBe('succeeded');
    expect(component.message()).toContain('atomically');
  });

  it('preserves failed state for retry and resumes the same audited change to success', async () => {
    vi.useFakeTimers();
    const api = createApi();
    api.retryRuleChange.mockReturnValue(of(queuedChange));
    api.ruleChange.mockReturnValue(of(succeededChange));
    const component = new RulesStudioComponent(api as unknown as ApiService);
    component.activeChange.set(failedChange);

    expect(component.activeChange()?.status).toBe('failed');

    component.retryActiveChange();
    expect(api.retryRuleChange).toHaveBeenCalledWith(failedChange.id);
    expect(component.activeChange()?.id).toBe(failedChange.id);
    expect(component.activeChange()?.status).toBe('queued');

    await vi.runAllTimersAsync();

    expect(component.activeChange()?.id).toBe(failedChange.id);
    expect(component.activeChange()?.status).toBe('succeeded');
  });

  it('supports cooperative cancellation for an active change', () => {
    const running = {
      ...queuedChange,
      status: 'running' as const,
      phase: 'recomputing',
      progressPercent: 45,
      attemptCount: 1,
    };
    const cancelling = { ...running, cancellationRequested: true };
    const api = createApi();
    api.cancelRuleChange.mockReturnValue(of(cancelling));
    const component = new RulesStudioComponent(api as unknown as ApiService);
    component.activeChange.set(running);

    component.cancelActiveChange();

    expect(api.cancelRuleChange).toHaveBeenCalledWith(running.id);
    expect(component.activeChange()?.cancellationRequested).toBe(true);
    expect(component.message()).toContain('safe boundary');
  });
});

function createApi() {
  return {
    ruleVersions: vi.fn().mockReturnValue(of([coefficientRule, achievementRule])),
    ruleChanges: vi.fn().mockReturnValue(of([queuedChange])),
    previewRule: vi.fn().mockReturnValue(of(coefficientPreview)),
    activateRule: vi.fn().mockReturnValue(of(queuedChange)),
    ruleChange: vi.fn().mockReturnValue(of(succeededChange)),
    cancelRuleChange: vi.fn().mockReturnValue(of({ ...queuedChange, status: 'cancelled' as const, phase: 'cancelled' })),
    retryRuleChange: vi.fn().mockReturnValue(of(queuedChange)),
  };
}
