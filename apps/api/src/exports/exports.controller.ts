import { Controller, Get, Header, Inject, Query } from '@nestjs/common';
import { LEGACY_ACCOUNT_ID } from '@sportos/db';
import { CurrentAccount } from '../auth/current-account.decorator.js';
import type { AuthenticatedAccount } from '../auth/auth.models.js';
import { parseDateRange } from '../query-validation.js';
import { ExportsService } from './exports.service.js';

@Controller('exports')
export class ExportsController {
  constructor(@Inject(ExportsService) private readonly exportsService: ExportsService) {}

  @Get('canonical')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Disposition', 'attachment; filename="sportos-canonical-export.json"')
  async canonical(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @CurrentAccount() account?: AuthenticatedAccount,
  ) {
    const range = parseDateRange(from, to, { required: true, maxDays: 3660 });
    return this.exportsService.canonical(range.from!, range.to!, account?.id ?? LEGACY_ACCOUNT_ID);
  }
}
