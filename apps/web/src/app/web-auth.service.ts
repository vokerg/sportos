import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { SPORTOS_API_BASE } from './core/config/api-base';

export interface BrowserSession {
  account: { id: string; displayName: string; email: string | null };
  expiresAt: string;
  absoluteExpiresAt: string;
}

export type BrowserAuthState = 'loading' | 'authenticated' | 'anonymous' | 'error';

@Injectable({ providedIn: 'root' })
export class WebAuthService {
  private readonly apiBase = inject(SPORTOS_API_BASE);
  readonly state = signal<BrowserAuthState>('loading');
  readonly session = signal<BrowserSession | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly loginMode = signal<'single-user' | 'oidc'>('oidc');
  readonly signingIn = signal(false);

  constructor(private readonly http: HttpClient) {
    window.addEventListener('sportos-auth-expired', () => this.markExpired());
  }

  loadSession(): void {
    this.state.set('loading');
    this.errorMessage.set(null);
    this.http.get<{ mode: 'single-user' | 'oidc' }>(`${this.apiBase}/auth/config`).subscribe({
      next: ({ mode }) => this.loginMode.set(mode),
      error: () => this.errorMessage.set('Sign-in configuration is unavailable. Please retry.'),
    });
    this.http.get<BrowserSession>(`${this.apiBase}/auth/session`).subscribe({
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
    window.location.assign(`${this.apiBase}/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  signInWithPassword(username: string, password: string): void {
    if (this.signingIn()) return;
    this.signingIn.set(true);
    this.errorMessage.set(null);
    this.http.post<BrowserSession>(`${this.apiBase}/auth/password`, { username, password }).subscribe({
      next: (session) => {
        this.session.set(session);
        this.state.set('authenticated');
        this.signingIn.set(false);
      },
      error: (error: unknown) => {
        this.signingIn.set(false);
        this.errorMessage.set(error instanceof HttpErrorResponse && error.status === 429
          ? 'Too many sign-in attempts. Try again in a minute.'
          : 'Sign-in failed. Check your username and password.');
      },
    });
  }

  signOut(): void {
    this.http.post<{ signedOut: boolean }>(`${this.apiBase}/auth/logout`, {}).subscribe({
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
