import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import type { ImportDiagnostic, ImportJob } from './api.service';
import {
  describeImportRequestError,
  describeImportUploadError,
  importDiagnosticKey,
  importDiagnosticLocation,
  importJobSuccessMessage,
  isActiveImportJob,
  isTerminalImportJob,
} from './import-workflow.view-model';

const diagnostic: ImportDiagnostic = {
  severity: 'warning',
  code: 'ROW_SKIPPED',
  message: 'Skipped invalid row.',
  phase: 'parse',
  sheetName: 'Sheet1',
  rowIndex: 3,
  sourceRecordId: '22222222-2222-4222-8222-222222222222',
  recordedAt: '2026-07-29T10:00:00.500Z',
};

const job: ImportJob = {
  id: '44444444-4444-4444-8444-444444444444',
  uploadId: '33333333-3333-4333-8333-333333333333',
  batchId: '11111111-1111-4111-8111-111111111111',
  filename: 'my-sport.xlsx',
  workbookKind: 'my_sport',
  uploadStatus: 'imported',
  status: 'succeeded',
  phase: 'completed',
  progressPercent: 100,
  attemptCount: 1,
  maxAttempts: 3,
  cancellationRequested: false,
  error: null,
  result: { dailyRows: 2, activities: 13, performanceEvents: 1, warnings: ['warning'] },
  createdAt: '2026-07-29T10:00:00.000Z',
  updatedAt: '2026-07-29T10:00:01.000Z',
  startedAt: '2026-07-29T10:00:00.100Z',
  completedAt: '2026-07-29T10:00:01.000Z',
};

describe('import workflow view model', () => {
  it('derives stable diagnostic display labels and keys', () => {
    expect(importDiagnosticLocation(diagnostic)).toBe('Sheet1 row 3');
    expect(importDiagnosticLocation({ ...diagnostic, rowIndex: null })).toBe('Sheet1');
    expect(importDiagnosticLocation({ ...diagnostic, sheetName: null, rowIndex: null })).toBe('Batch-level diagnostic');
    expect(importDiagnosticKey(diagnostic)).toContain('ROW_SKIPPED');
    expect(importDiagnosticKey(diagnostic)).toContain('Sheet1');
  });

  it('summarizes terminal import results without authoritative calculations', () => {
    expect(importJobSuccessMessage(job)).toBe(
      'Import completed: 2 daily rows, 13 activities, 1 performance events, and 1 warnings.',
    );
    expect(isTerminalImportJob(job)).toBe(true);
    expect(isActiveImportJob({ ...job, status: 'queued' })).toBe(true);
    expect(isActiveImportJob({ ...job, status: 'running' })).toBe(true);
    expect(isActiveImportJob(job)).toBe(false);
  });

  it('keeps duplicate upload guidance actionable and path-free', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: {
        code: 'DUPLICATE_UPLOAD',
        message: 'private path /srv/uploads/source.xlsx',
        duplicate: { filename: 'my-sport.xlsx', batchStatus: 'scored' },
      },
    });

    const message = describeImportUploadError(error);

    expect(message).toContain('my-sport.xlsx was already uploaded');
    expect(message).toContain('scored');
    expect(message).not.toContain('/srv/uploads');
  });

  it('maps request failures to bounded user-safe messages', () => {
    expect(describeImportRequestError(
      new HttpErrorResponse({ status: 404 }),
      'Could not load details.',
    )).toBe('The selected import job or batch no longer exists.');

    expect(describeImportRequestError(
      new HttpErrorResponse({ status: 500, error: { message: 'Sanitized server message.' } }),
      'Could not load details.',
    )).toBe('Sanitized server message.');
  });
});
