import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { SPORTOS_API_BASE } from '../../../core/config/api-base';

@Injectable({ providedIn: 'root' })
export class MobileConnectApiService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(SPORTOS_API_BASE);

  approve(requestId: string) {
    return this.http.post<{ redirectUrl: string }>(`${this.apiBase}/auth/mobile/approve`, { requestId });
  }

  isExpired(error: unknown): boolean {
    return error instanceof HttpErrorResponse && (error.status === 400 || error.status === 401);
  }
}
