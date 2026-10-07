import { Body, Controller, Get, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentAccount } from '../auth/current-account.decorator.js';
import type { AuthenticatedAccount } from '../auth/auth.models.js';
import { DbProvider, ActivityDetailDbProvider } from '../db.provider.js';
import { UploadStorage } from '../storage/upload-storage.js';
import { GarminLocalIngestService } from './garmin-local-ingest.service.js';

@Controller('garmin/local')
export class GarminLocalIngestController {
  private readonly retention: GarminLocalIngestService;
  constructor(primary: DbProvider, detail: ActivityDetailDbProvider, storage: UploadStorage) { this.retention = new GarminLocalIngestService(primary, detail, storage); }
  @Get('cache/:providerActivityId')
  cache(@Param('providerActivityId') id: string, @Query() query: Record<string, unknown>, @CurrentAccount() account?: AuthenticatedAccount) { return this.retention.cache(id, query, account); }
  @Post('resource')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 4_000_000, files: 1, fields: 0 } }))
  retainResource(@UploadedFile() file: { buffer: Buffer; size: number } | undefined, @CurrentAccount() account?: AuthenticatedAccount) { return this.retention.retainResource(file, account); }
  @Post('original')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 2, fieldSize: 16384 } }))
  retainOriginal(@UploadedFile() file: { buffer: Buffer; size: number } | undefined, @Body() body: unknown, @CurrentAccount() account?: AuthenticatedAccount) { return this.retention.retainOriginal(file, body, account); }
  @Post('commit')
  commit(@Body() body: unknown, @CurrentAccount() account?: AuthenticatedAccount) { return this.retention.commit(body, account); }
}
