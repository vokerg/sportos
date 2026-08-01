import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';

export interface BrowserSession {
  account: { id: string; displayName: string; email: string | null };
  expiresAt: string;
  absoluteExpiresAt: string;
}

export type BrowserAuthState = 'loading' | 'authenticated' | 'anonymous' | 'error';

@Injectable({ providedIn: 'root' })
export class WebAuthService {
  readonly apiBase = signal('http://localhost:3000');
  readonly state = signal<BrowserAuthState>('loading');
  readonly session = signal<BrowserSession | null>(null);
  readonly errorMessage = signal<string | null>(null);

  constructor(private readonly http: HttpClient) {
    window.addEventListener('sportos-auth-expired', () => this.markExpired());
  }

  loadSession(): void {
    this.state.set('loading');
    this.errorMessage.set(null);
    this.http.get<BrowserSession>(`${this.apiBase()}/auth/session`).subscribe({
      next: (session) => {
        this.session.set(session);
        this.state.set('authenticated');
      },
      error: (error: unknown) => {
        this.session.set(null);
        if (error instanceof HttpErrorResponse && error.status === 401) {
          this.state.set('anonymous');
          return;
        }
        this.errorMessage.set('The SportOS session service is unavailable.');
        this.state.set('error');
      },
    });
  }

  signIn(): void {
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.assign(`${this.apiBase()}/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  signOut(): void {
    this.http.post<{ signedOut: boolean }>(`${this.apiBase()}/auth/logout`, {}).subscribe({
      next: () => this.markExpired(),
      error: () => this.markExpired(),
    });
  }

  markExpired(): void {
    this.session.set(null);
    this.errorMessage.set(null);
    this.state.set('anonymous');
  }
}
