import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { SPORTOS_API_BASE } from '../../../core/config/api-base';

@Injectable({ providedIn: 'root' })
export class McpConnectApiService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(SPORTOS_API_BASE);
  approve(requestId: string) {
    return this.http.post<{ redirectUrl: string }>(`${this.base}/mcp/oauth/approve`, { requestId });
  }
  disconnect() {
    return this.http.post<{ revoked: true }>(`${this.base}/mcp/oauth/disconnect`, {});
  }
}
