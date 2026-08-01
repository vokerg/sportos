import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ActiveRuleChangeError,
  LEGACY_ACCOUNT_ID,
  RuleChangeStateError,
  RuleOverlapError,
  RuleProposalValidationError,
  RuleReplacementError,
  type RuleProposal,
} from '@sportos/db';
import { CurrentAccount } from '../auth/current-account.decorator.js';
import type { AuthenticatedAccount } from '../auth/auth.models.js';
import {
  InvalidRuleChangeReasonError,
  RulePreviewLimitError,
  RulesService,
  StaleRulePreviewError,
  type ActivateRuleChangeRequest,
} from './rules.service.js';

@Controller('rules')
export class RulesController {
  constructor(@Inject(RulesService) private readonly rulesService: RulesService) {}

  @Get()
  listRules(@CurrentAccount() account?: AuthenticatedAccount) {
    return this.rulesService.listRules(account?.id ?? LEGACY_ACCOUNT_ID);
  }

  @Get('changes')
  listChanges(@Query('limit') limit?: string, @CurrentAccount() account?: AuthenticatedAccount) {
    const parsed = limit === undefined ? 50 : Number(limit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
      throw new BadRequestException({ code: 'INVALID_LIMIT', message: 'Limit must be an integer from 1 through 200.' });
    }
    return this.rulesService.listChanges(parsed, account?.id ?? LEGACY_ACCOUNT_ID);
  }

  @Get('changes/:changeId')
  async getChange(@Param('changeId') changeId: string, @CurrentAccount() account?: AuthenticatedAccount) {
    assertUuid(changeId, 'INVALID_RULE_CHANGE_ID');
    const change = await this.rulesService.getChange(changeId, account?.id ?? LEGACY_ACCOUNT_ID);
    if (!change) throw new NotFoundException({ code: 'RULE_CHANGE_NOT_FOUND', message: 'Rule change was not found.' });
    return change;
  }

  @Post('preview')
  async preview(@Body() proposal: RuleProposal, @CurrentAccount() account?: AuthenticatedAccount) {
    try {
      return await this.rulesService.preview(proposal, account?.id ?? LEGACY_ACCOUNT_ID);
    } catch (error) {
      throw mapRuleError(error);
    }
  }

  @Post('activate')
  async activate(@Body() request: ActivateRuleChangeRequest, @CurrentAccount() account?: AuthenticatedAccount) {
    try {
      return await this.rulesService.activate(request, account?.id ?? LEGACY_ACCOUNT_ID);
    } catch (error) {
      throw mapRuleError(error);
    }
  }

  @Post('changes/:changeId/retry')
  async retry(@Param('changeId') changeId: string, @CurrentAccount() account?: AuthenticatedAccount) {
    assertUuid(changeId, 'INVALID_RULE_CHANGE_ID');
    try {
      const change = await this.rulesService.retry(changeId, account?.id ?? LEGACY_ACCOUNT_ID);
      if (!change) throw new NotFoundException({ code: 'RULE_CHANGE_NOT_FOUND', message: 'Rule change was not found.' });
      return change;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw mapRuleError(error);
    }
  }

  @Post('changes/:changeId/cancel')
  async cancel(@Param('changeId') changeId: string, @CurrentAccount() account?: AuthenticatedAccount) {
    assertUuid(changeId, 'INVALID_RULE_CHANGE_ID');
    const change = await this.rulesService.cancel(changeId, account?.id ?? LEGACY_ACCOUNT_ID);
    if (!change) throw new NotFoundException({ code: 'RULE_CHANGE_NOT_FOUND', message: 'Rule change was not found.' });
    return change;
  }
}

function mapRuleError(error: unknown): BadRequestException | ConflictException {
  if (error instanceof RuleProposalValidationError) {
    return new BadRequestException({ code: 'INVALID_RULE_PROPOSAL', message: error.message, issues: error.issues });
  }
  if (error instanceof InvalidRuleChangeReasonError) {
    return new BadRequestException({ code: 'INVALID_CHANGE_REASON', message: error.message });
  }
  if (error instanceof RulePreviewLimitError) {
    return new BadRequestException({ code: 'RULE_PREVIEW_LIMIT', message: error.message, limit: error.limit });
  }
  if (error instanceof StaleRulePreviewError) {
    return new ConflictException({ code: 'STALE_RULE_PREVIEW', message: error.message });
  }
  if (error instanceof ActiveRuleChangeError) {
    return new ConflictException({ code: 'ACTIVE_RULE_CHANGE', message: error.message, changeId: error.changeId });
  }
  if (error instanceof RuleOverlapError) {
    return new ConflictException({ code: 'RULE_RANGE_OVERLAP', message: error.message, conflictingRuleId: error.conflictingRuleId });
  }
  if (error instanceof RuleReplacementError) {
    return new ConflictException({ code: error.code, message: error.message });
  }
  if (error instanceof RuleChangeStateError) {
    return new ConflictException({ code: error.code, message: error.message });
  }
  return new BadRequestException({ code: 'RULE_CHANGE_FAILED', message: 'Rule change could not be processed.' });
}

function assertUuid(value: string, code: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestException({ code, message: 'Identifier must be a UUID.' });
  }
}
