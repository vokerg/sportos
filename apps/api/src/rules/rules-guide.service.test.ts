import { afterEach, expect, it, vi } from 'vitest';
import { RuleChangesRepository, type RuleVersionReadModel } from '@sportos/db';
import { RulesService } from './rules.service.js';
import type { DbProvider } from '../db.provider.js';

afterEach(() => vi.restoreAllMocks());
it('describes only rules read through the requested account context', async () => {
  const rule: RuleVersionReadModel = { id: 'rule', code: 'swim.1k.sub20.bonus', name: 'Swim',
    activityType: 'swim', ruleKind: 'achievement', metric: 'moving_pace_s_per_km',
    thresholdOperator: 'lt', thresholdValue: 1200, points: 2000, pointsMultiplier: 'completed_1k_blocks',
    validFrom: '1900-01-01', priority: 90, enabled: true, version: 3, supersedesRuleId: 'previous', createdAt: '2026-01-01' };
  const list = vi.spyOn(RuleChangesRepository.prototype, 'listRuleVersions').mockResolvedValueOnce([rule]).mockResolvedValueOnce([]);
  const withAccount = vi.fn(async (_owner: string, action: (db: unknown) => unknown) => action({}));
  const service = new RulesService({ withAccount } as unknown as DbProvider);
  expect(await service.listRules('owner-a')).toMatchObject([{ id: 'rule', guide: { award: '+2,000 per completed km' } }]);
  expect(await service.listRules('owner-b')).toEqual([]);
  expect(withAccount.mock.calls.map(call => call[0])).toEqual(['owner-a', 'owner-b']);
  expect(list).toHaveBeenCalledTimes(2);
  expect(rule).not.toHaveProperty('guide');
});
