import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { SPORTOS_API_BASE } from '../../../core/config/api-base';
import type { CanonicalExportBundle } from '../model/export.models';

@Injectable({ providedIn: 'root' })
export class ExportApiService {
  private readonly apiBase = inject(SPORTOS_API_BASE);

  constructor(private readonly http: HttpClient) {}

  canonicalExport(from: string, to: string) {
    return this.http.get<CanonicalExportBundle>(`${this.apiBase}/exports/canonical`, {
      params: queryParams({ from, to }),
    });
  }
}

function queryParams<T extends object>(values: T): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(values)) {
    if ((typeof value === 'string' || typeof value === 'number') && value !== '') {
      params = params.set(key, String(value));
    }
  }
  return params;
}
