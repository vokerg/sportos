import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { LEGACY_ACCOUNT_ID } from '@sportos/db';
import { CurrentAccount } from '../auth/current-account.decorator.js';
import type { AuthenticatedAccount } from '../auth/auth.models.js';
import { ProvidersService } from './providers.service.js';

interface RedirectResponse {
  redirect(status: number, url: string): void;
}

@Controller('providers')
export class ProvidersController {
  constructor(private readonly providersService: ProvidersService) {}

  @Get('connections')
  connections(@CurrentAccount() account?: AuthenticatedAccount) {
    return this.providersService.listConnections(account?.id ?? LEGACY_ACCOUNT_ID);
  }

  @Post('strava/connect')
  startStrava(
    @Body() body: { returnTo?: string },
    @CurrentAccount() account?: AuthenticatedAccount,
  ) {
    return this.providersService.startStrava(account?.id ?? LEGACY_ACCOUNT_ID, body.returnTo ?? '/');
  }

  @Get('strava/callback')
  async completeStrava(
    @Query('state') state: string | undefined,
    @Query('code') code: string | undefined,
    @Query('scope') scope: string | undefined,
    @Query('error') providerError: string | undefined,
    @CurrentAccount() account: AuthenticatedAccount | undefined,
    @Res() response: RedirectResponse,
  ): Promise<void> {
    const result = await this.providersService.completeStrava(account?.id ?? LEGACY_ACCOUNT_ID, {
      state,
      code,
      scope,
      providerError,
    });
    const webOrigin = validWebOrigin(process.env.SPORTOS_WEB_ORIGIN ?? 'http://localhost:4210');
    response.redirect(303, new URL(result.returnTo, webOrigin).toString());
  }

  @Post('connections/:connectionId/sync')
  enqueueSync(
    @Param('connectionId') connectionId: string,
    @Body() body: { mode?: string; after?: string; before?: string },
    @CurrentAccount() account?: AuthenticatedAccount,
  ) {
    requireUuid(connectionId, 'connectionId');
    return this.providersService.enqueueSync(account?.id ?? LEGACY_ACCOUNT_ID, connectionId, body);
  }

  @Get('connections/:connectionId/jobs')
  listJobs(
    @Param('connectionId') connectionId: string,
    @Query('limit') limit: string | undefined,
    @CurrentAccount() account?: AuthenticatedAccount,
  ) {
    requireUuid(connectionId, 'connectionId');
    return this.providersService.listSyncJobs(
      account?.id ?? LEGACY_ACCOUNT_ID,
      connectionId,
      boundedLimit(limit),
    );
  }

  @Post('connections/:connectionId/disconnect')
  disconnect(
    @Param('connectionId') connectionId: string,
    @CurrentAccount() account?: AuthenticatedAccount,
  ) {
    requireUuid(connectionId, 'connectionId');
    return this.providersService.disconnect(account?.id ?? LEGACY_ACCOUNT_ID, connectionId);
  }

  @Get('jobs/:jobId')
  job(@Param('jobId') jobId: string, @CurrentAccount() account?: AuthenticatedAccount) {
    requireUuid(jobId, 'jobId');
    return this.providersService.getSyncJob(account?.id ?? LEGACY_ACCOUNT_ID, jobId);
  }

  @Post('jobs/:jobId/retry')
  retry(@Param('jobId') jobId: string, @CurrentAccount() account?: AuthenticatedAccount) {
    requireUuid(jobId, 'jobId');
    return this.providersService.retrySync(account?.id ?? LEGACY_ACCOUNT_ID, jobId);
  }

  @Post('jobs/:jobId/cancel')
  cancel(@Param('jobId') jobId: string, @CurrentAccount() account?: AuthenticatedAccount) {
    requireUuid(jobId, 'jobId');
    return this.providersService.cancelSync(account?.id ?? LEGACY_ACCOUNT_ID, jobId);
  }
}

function requireUuid(value: string, field: string): void {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return;
  throw new BadRequestException({ code: 'INVALID_PROVIDER_ID', message: `${field} must be a UUID.`, field });
}

function boundedLimit(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 20;
  if (!/^\d+$/.test(value)) throw invalidLimit();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) throw invalidLimit();
  return parsed;
}

function invalidLimit(): BadRequestException {
  return new BadRequestException({ code: 'INVALID_PROVIDER_PAGINATION', message: 'limit must be an integer from 1 to 100.' });
}

function validWebOrigin(value: string): URL {
  const url = new URL(value);
  if ((url.protocol !== 'https:' && url.hostname !== 'localhost') || url.pathname !== '/') {
    throw new Error('SPORTOS_WEB_ORIGIN must be an HTTPS origin.');
  }
  return url;
}
