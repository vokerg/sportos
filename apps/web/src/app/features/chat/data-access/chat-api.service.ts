import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { SPORTOS_API_BASE } from '../../../core/config/api-base';
import type { ChatAnswer, ChatRequest } from '../model/chat.models';
@Injectable({ providedIn: 'root' })
export class ChatApiService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(SPORTOS_API_BASE);
  answer(request: ChatRequest) {
    return this.http.post<ChatAnswer>(`${this.base}/chat/answers`, request).pipe(catchError((error: unknown) => {
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      return throwError(() => new Error(status === 401 ? 'Your session expired. Sign in again.' : status === 429 ? 'Chat is busy. Please try again shortly.' : 'Chat could not answer. Please try again.'));
    }));
  }
}
