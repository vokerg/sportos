import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { SPORTOS_API_BASE } from '../../../core/config/api-base';
import type {
  ImportBatchDetail,
  ImportBatchHistoryPage,
  ImportJob,
  ImportLocalFilesResponse,
  UploadWorkbookKind,
  UploadWorkbookResponse,
} from '../model/imports.models';

@Injectable({ providedIn: 'root' })
export class ImportsApiService {
  private readonly apiBase = inject(SPORTOS_API_BASE);

  constructor(private readonly http: HttpClient) {}

  uploadWorkbook(file: File, workbookKind: UploadWorkbookKind) {
    const body = new FormData();
    body.append('file', file, file.name);
    body.append('workbookKind', workbookKind);
    return this.http.post<UploadWorkbookResponse>(`${this.apiBase}/imports/upload`, body, {
      observe: 'events',
      reportProgress: true,
    });
  }

  importJob(jobId: string) {
    return this.http.get<ImportJob>(`${this.apiBase}/imports/jobs/${encodeURIComponent(jobId)}`);
  }

  retryImportJob(jobId: string) {
    return this.http.post<ImportJob>(`${this.apiBase}/imports/jobs/${encodeURIComponent(jobId)}/retry`, {});
  }

  cancelImportJob(jobId: string) {
    return this.http.post<ImportJob>(`${this.apiBase}/imports/jobs/${encodeURIComponent(jobId)}/cancel`, {});
  }

  importLocalFiles(mySportPath?: string, runDbPath?: string) {
    return this.http.post<ImportLocalFilesResponse>(`${this.apiBase}/imports/local-files`, { mySportPath, runDbPath });
  }

  importHistory(limit = 20, offset = 0) {
    return this.http.get<ImportBatchHistoryPage>(`${this.apiBase}/imports?limit=${limit}&offset=${offset}`);
  }

  importBatchDetail(batchId: string, diagnosticLimit = 100, diagnosticOffset = 0) {
    return this.http.get<ImportBatchDetail>(
      `${this.apiBase}/imports/${encodeURIComponent(batchId)}?diagnosticLimit=${diagnosticLimit}&diagnosticOffset=${diagnosticOffset}`,
    );
  }
}
