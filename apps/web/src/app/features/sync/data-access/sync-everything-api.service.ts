import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom, fromEvent, takeUntil, timeout } from 'rxjs';
import { SPORTOS_API_BASE } from '../../../core/config/api-base';

/** Transport for the fixed Update everything workflow; session/CSRF use core interceptors. */
@Injectable({ providedIn: 'root' })
export class SyncEverythingApiService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(SPORTOS_API_BASE);
  read(path: string, signal: AbortSignal): Promise<unknown> {
    return firstValueFrom(this.http.get<unknown>(this.base + path).pipe(timeout(30_000), takeUntil(fromEvent(signal, 'abort'))));
  }
  post(path: string, body: object, signal: AbortSignal): Promise<unknown> {
    return firstValueFrom(this.http.post<unknown>(this.base + path, body).pipe(timeout(30_000), takeUntil(fromEvent(signal, 'abort'))));
  }
}
