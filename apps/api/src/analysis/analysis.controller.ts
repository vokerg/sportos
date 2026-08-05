import { Body, Controller, Inject, Post } from '@nestjs/common';
import { LEGACY_ACCOUNT_ID } from '@sportos/db';
import { CurrentAccount } from '../auth/current-account.decorator.js';
import type { AuthenticatedAccount } from '../auth/auth.models.js';
import { AnalysisService } from './analysis.service.js';
import { parseAnalysisToolRequest } from './analysis.validation.js';

@Controller('analysis')
export class AnalysisController {
  constructor(@Inject(AnalysisService) private readonly analysisService: AnalysisService) {}

  @Post('tools/execute')
  async execute(@Body() body: unknown, @CurrentAccount() account?: AuthenticatedAccount) {
    const request = parseAnalysisToolRequest(body);
    return this.analysisService.execute(request, account?.id ?? LEGACY_ACCOUNT_ID);
  }
}
