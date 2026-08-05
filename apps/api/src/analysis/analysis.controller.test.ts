import { BadRequestException } from '@nestjs/common';
import { LEGACY_ACCOUNT_ID } from '@sportos/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedAccount } from '../auth/auth.models.js';
import { AnalysisController } from './analysis.controller.js';
import type { AnalysisService } from './analysis.service.js';

describe('AnalysisController read-only boundary', () => {
  let service: { executeTool: ReturnType<typeof vi.fn>; answer: ReturnType<typeof vi.fn> };
  let controller: AnalysisController;

  beforeEach(() => {
    service = {
      executeTool: vi.fn().mockResolvedValue({ readOnly: true }),
      answer: vi.fn().mockResolvedValue({ readOnly: true }),
    };
    controller = new AnalysisController(service as unknown as AnalysisService);
  });

  it('forwards an exact tool request with authenticated ownership', async () => {
    const account = { id: '11111111-1111-4111-8111-111111111111' } as AuthenticatedAccount;
    await controller.execute({
      tool: 'daily_summary',
      input: { from: '2026-05-01', to: '2026-05-31', limit: 31 },
    }, account);
    expect(service.executeTool).toHaveBeenCalledWith({
      tool: 'daily_summary',
      input: { from: '2026-05-01', to: '2026-05-31', limit: 31 },
    }, account.id);
  });

  it('forwards a bounded question and tool scope without accepting an owner field', async () => {
    await controller.answer({
      question: 'What changed during May?',
      tool: 'daily_summary',
      input: { from: '2026-05-01', to: '2026-05-31', limit: 31 },
    });
    expect(service.answer).toHaveBeenCalledWith({
      question: 'What changed during May?',
      toolRequest: {
        tool: 'daily_summary',
        input: { from: '2026-05-01', to: '2026-05-31', limit: 31 },
      },
    }, LEGACY_ACCOUNT_ID);
  });

  it('rejects unsupported tools, ambiguous ranges, impossible dates, owner fields, and oversized questions', async () => {
    const invalidRequests = [
      { tool: 'sql', input: { query: 'select * from activities' } },
      { tool: 'daily_summary', input: { from: '2026-05-01' } },
      { tool: 'daily_score_breakdown', input: { date: '2026-02-30' } },
      { tool: 'daily_score_breakdown', input: { date: '2026-05-18', ownerId: 'foreign' } },
    ];
    for (const request of invalidRequests) {
      await expect(controller.execute(request)).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(controller.answer({
      question: 'x'.repeat(501),
      tool: 'daily_score_breakdown',
      input: { date: '2026-05-18' },
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(service.executeTool).not.toHaveBeenCalled();
    expect(service.answer).not.toHaveBeenCalled();
  });
});
