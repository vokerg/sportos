import { Body, Controller, Inject, Post } from '@nestjs/common';
import { LEGACY_ACCOUNT_ID } from '@sportos/db';
import { CurrentAccount } from '../auth/current-account.decorator.js';
import type { AuthenticatedAccount } from '../auth/auth.models.js';
import { AnalysisService } from './analysis.service.js';
import { parseAnalysisAnswerRequest, parseAnalysisToolRequest } from './analysis.validation.js';

@Controller('analysis')
export class AnalysisController {
  constructor(@Inject(AnalysisService) private readonly analysisService: AnalysisService) {}

  @Post('tools/execute')
  execute(@Body() body: unknown, @CurrentAccount() account?: AuthenticatedAccount) {
    return this.analysisService.executeTool(
      parseAnalysisToolRequest(body),
      account?.id ?? LEGACY_ACCOUNT_ID,
    );
  }

  @Post('answers')
  answer(@Body() body: unknown, @CurrentAccount() account?: AuthenticatedAccount) {
    return this.analysisService.answer(
      parseAnalysisAnswerRequest(body),
      account?.id ?? LEGACY_ACCOUNT_ID,
    );
  }
}
