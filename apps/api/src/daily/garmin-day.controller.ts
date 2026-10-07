import { BadRequestException, Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { GARMIN_DAY_CATEGORIES, LEGACY_ACCOUNT_ID, isIsoDate, type GarminDayCategory } from '@sportos/db';
import { CurrentAccount } from '../auth/current-account.decorator.js';
import type { AuthenticatedAccount } from '../auth/auth.models.js';
import { GarminDayService } from './garmin-day.service.js';
function date(value: string) {
  if (!isIsoDate(value)) throw new BadRequestException('Date must be a real YYYY-MM-DD calendar date.');
  return value;
}
@Controller('daily')
export class GarminDayController {
  constructor(private readonly garmin: GarminDayService) {}
  @Get(':date/garmin')
  read(@Param('date') value: string, @CurrentAccount() account?: AuthenticatedAccount) {
    return this.garmin.read(account?.id ?? LEGACY_ACCOUNT_ID, date(value));
  }
  @Get(':date/garmin/resources/:category')
  resource(@Param('date') value: string, @Param('category') category: string, @CurrentAccount() account?: AuthenticatedAccount) {
    date(value);
    if (!GARMIN_DAY_CATEGORIES.includes(category as GarminDayCategory)) throw new BadRequestException('Unsupported Garmin day category.');
    return this.garmin.resource(account?.id ?? LEGACY_ACCOUNT_ID, value, category as GarminDayCategory);
  }
  @Post(':date/garmin')
  async fetch(@Param('date') value: string, @Body() raw: unknown, @CurrentAccount() account?: AuthenticatedAccount,
    @Req() request?: { on: (event: string, listener: () => void) => void; off: (event: string, listener: () => void) => void },
    @Res({ passthrough: true }) response?: { on: (event: string, listener: () => void) => void; off: (event: string, listener: () => void) => void }) {
    date(value);
    const body = raw ?? {};
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'refresh') || ('refresh' in body && typeof body.refresh !== 'boolean')) throw new BadRequestException('Invalid Garmin day fetch request.');
    // Conservative server-local gate plus helper-local validation. No UTC date coercion.
    const today = new Date(); const localDate = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    if (value >= localDate) throw new BadRequestException('Select a completed Garmin calendar date.');
    const cancellation = new AbortController(); const abort = () => cancellation.abort();
    request?.on('aborted', abort); response?.on('close', abort);
    try { return await this.garmin.fetch(account ?? { id: LEGACY_ACCOUNT_ID } as AuthenticatedAccount, value, 'refresh' in body && body.refresh === true, cancellation.signal); }
    finally { request?.off('aborted', abort); response?.off('close', abort); }
  }
}
