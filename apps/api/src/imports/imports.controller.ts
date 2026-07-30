import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImportsService } from './imports.service.js';
import { MAX_WORKBOOK_UPLOAD_BYTES, type MultipartWorkbookFile } from './workbook-upload.js';

@Controller('imports')
export class ImportsController {
  constructor(@Inject(ImportsService) private readonly importsService: ImportsService) {}

  @Get()
  history(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.importsService.history(
      parseBoundedInteger(limit, { name: 'limit', defaultValue: 20, minimum: 1, maximum: 100 }),
      parseBoundedInteger(offset, { name: 'offset', defaultValue: 0, minimum: 0, maximum: 10_000 }),
    );
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    limits: { files: 1, fileSize: MAX_WORKBOOK_UPLOAD_BYTES },
  }))
  uploadWorkbook(
    @UploadedFile() file: MultipartWorkbookFile | undefined,
    @Body('workbookKind') workbookKind?: string,
  ) {
    return this.importsService.uploadWorkbook({ file, workbookKind });
  }

  @Get(':batchId')
  async detail(
    @Param('batchId') batchId: string,
    @Query('diagnosticLimit') diagnosticLimit?: string,
    @Query('diagnosticOffset') diagnosticOffset?: string,
  ) {
    if (!isUuid(batchId)) {
      throw new BadRequestException({
        code: 'INVALID_IMPORT_BATCH_ID',
        message: 'Import batch id must be a UUID.',
        batchId,
      });
    }

    const detail = await this.importsService.detail(
      batchId,
      parseBoundedInteger(diagnosticLimit, {
        name: 'diagnosticLimit',
        defaultValue: 100,
        minimum: 1,
        maximum: 250,
      }),
      parseBoundedInteger(diagnosticOffset, {
        name: 'diagnosticOffset',
        defaultValue: 0,
        minimum: 0,
        maximum: 50_000,
      }),
    );
    if (!detail) {
      throw new NotFoundException({
        code: 'IMPORT_BATCH_NOT_FOUND',
        message: `No import batch exists with id ${batchId}.`,
        batchId,
      });
    }
    return detail;
  }

  @Post('local-files')
  importLocalFiles(@Body() body: { mySportPath?: string; runDbPath?: string }) {
    return this.importsService.importLocalFiles(body);
  }
}

interface BoundedIntegerOptions {
  name: string;
  defaultValue: number;
  minimum: number;
  maximum: number;
}

export function parseBoundedInteger(value: string | undefined, options: BoundedIntegerOptions): number {
  if (value === undefined || value.trim() === '') return options.defaultValue;
  if (!/^\d+$/.test(value)) throw invalidPagination(options, value);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < options.minimum || parsed > options.maximum) {
    throw invalidPagination(options, value);
  }
  return parsed;
}

function invalidPagination(options: BoundedIntegerOptions, value: string): BadRequestException {
  return new BadRequestException({
    code: 'INVALID_IMPORT_PAGINATION',
    message: `${options.name} must be an integer from ${options.minimum} to ${options.maximum}.`,
    field: options.name,
    value,
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
