import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SPORTOS_API_BASE } from './core/config/api-base';

// The standard app shell requires an authenticated browser session before
// rendering routes. Approval is still protected server-side by cookie + CSRF.
@Component({
  selector: 'sportos-mobile-connect',
  standalone: true,
  template: `
    <section class="card connect" aria-labelledby="mobile-connect-title">
      <h1 id="mobile-connect-title">Connect SportOS for iPhone</h1>
      <p>Only approve if you started sign-in in your SportOS iPhone app.
        Approval gives that device access to your private training data until
        the session expires or you sign out on the device.</p>
      @if (invalidRequest()) {
        <p role="alert">This link is invalid. Restart sign-in from the iPhone app.</p>
      } @else if (errorMessage()) {
        <p role="alert">{{ errorMessage() }}</p>
      }
      @if (!invalidRequest() && !approved()) {
        <button type="button" [disabled]="busy()" (click)="approve()">
          {{ busy() ? 'Connecting…' : 'Approve iPhone sign-in' }}
        </button>
      }
      @if (approved()) {
        <p role="status">Approved. Return to the SportOS iPhone app if it did not open automatically.</p>
      }
    </section>
  `,
  styles: [`
    .connect { max-width: 540px; margin: 48px auto; padding: 28px; }
    .connect button { min-height: 44px; margin-top: 16px; }
  `],
})
export class MobileConnectComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(SPORTOS_API_BASE);
  private readonly requestId = this.route.snapshot.queryParamMap.get('request') ?? '';
  readonly invalidRequest = signal(!/^[A-Za-z0-9_-]{43}$/.test(this.requestId));
  readonly busy = signal(false);
  readonly approved = signal(false);
  readonly errorMessage = signal<string | null>(null);

  approve(): void {
    if (this.invalidRequest() || this.busy() || this.approved()) return;
    this.busy.set(true);
    this.errorMessage.set(null);
    this.http.post<{ redirectUrl: string }>(`${this.apiBase}/auth/mobile/approve`, {
      requestId: this.requestId,
    }).subscribe({
      next: ({ redirectUrl }) => {
        this.busy.set(false);
        // The API constructs a fixed deep link; never navigate to arbitrary URLs.
        if (!/^sportos:\/\/auth\/callback\?/.test(redirectUrl)) {
          this.errorMessage.set('The mobile callback was rejected.');
          return;
        }
        this.approved.set(true);
        window.location.assign(redirectUrl);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.errorMessage.set(error instanceof HttpErrorResponse && (error.status === 400 || error.status === 401)
          ? 'The request expired or was already used. Restart sign-in on your iPhone.'
          : 'Could not approve sign-in. Please try again.');
      },
    });
  }
}
