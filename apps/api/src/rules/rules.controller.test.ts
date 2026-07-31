import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { RuleProposalValidationError } from '@sportos/domain';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { RulesController } from './rules.controller.js';
import { StaleRulePreviewError, type RulesService } from './rules.service.js';

const changeId = '22222222-2222-4222-8222-222222222222';
const proposal = {
  code: 'run.km.default',
  name: 'Run coefficient v2',
  activityType: 'run' as const,
  ruleKind: 'coefficient' as const,
  metric: 'distance_km',
  coefficient: 1200,
  validFrom: '2026-05-18',
  priority: 20,
};

describe('RulesController', () => {
  it('bounds audit history limits', () => {
    const controller = new RulesController(createService() as unknown as RulesService);
    expect(() => controller.listChanges('0')).toThrow(BadRequestException);
    expect(() => controller.listChanges('201')).toThrow(BadRequestException);
  });

  it('returns structured proposal validation issues', async () => {
    const service = createService();
    service.preview.mockRejectedValue(new RuleProposalValidationError([
      { field: 'coefficient', code: 'INVALID_COEFFICIENT', message: 'Coefficient must be positive.' },
    ]));
    const controller = new RulesController(service as unknown as RulesService);

    await expect(controller.preview(proposal)).rejects.toBeInstanceOf(BadRequestException);
    try {
      await controller.preview(proposal);
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'INVALID_RULE_PROPOSAL',
        issues: [{ code: 'INVALID_COEFFICIENT' }],
      });
    }
  });

  it('rejects stale confirmation fingerprints as a conflict', async () => {
    const service = createService();
    service.activate.mockRejectedValue(new StaleRulePreviewError());
    const controller = new RulesController(service as unknown as RulesService);

    await expect(controller.activate({
      proposal,
      previewFingerprint: 'stale',
      reason: 'Change coefficient.',
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns not found for an unknown valid audit id and rejects malformed ids', async () => {
    const service = createService();
    service.getChange.mockResolvedValue(null);
    const controller = new RulesController(service as unknown as RulesService);

    await expect(controller.getChange(changeId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.getChange('not-a-uuid')).rejects.toBeInstanceOf(BadRequestException);
  });
});

function createService() {
  return {
    listRules: vi.fn().mockResolvedValue([]),
    listChanges: vi.fn().mockResolvedValue([]),
    getChange: vi.fn().mockResolvedValue(null),
    preview: vi.fn().mockResolvedValue({ proposal, preview: { rows: [] }, previewFingerprint: 'a'.repeat(64) }),
    activate: vi.fn().mockResolvedValue({ id: changeId }),
    retry: vi.fn().mockResolvedValue({ id: changeId }),
    cancel: vi.fn().mockResolvedValue({ id: changeId }),
  };
}
