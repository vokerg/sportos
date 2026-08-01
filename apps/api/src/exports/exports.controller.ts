import { Controller, Get, Header, Inject, Query } from '@nestjs/common';
import { parseDateRange } from '../query-validation.js';
import { ExportsService } from './exports.service.js';

@Controller('exports')
export class ExportsController {
  constructor(@Inject(ExportsService) private readonly exportsService: ExportsService) {}

  @Get('canonical')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Disposition', 'attachment; filename="sportos-canonical-export.json"')
  async canonical(@Query('from') from?: string, @Query('to') to?: string) {
    const range = parseDateRange(from, to, { required: true, maxDays: 3660 });
    return this.exportsService.canonical(range.from!, range.to!);
  }
}
