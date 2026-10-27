import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MobileConnectApiService } from './features/mobile-auth/data-access/mobile-connect-api.service';

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
        <p role="status">Approved. Open SportOS on your iPhone to finish sign-in.</p>
        <button type="button" (click)="openApp()">Open SportOS iPhone app</button>
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
  private readonly api = inject(MobileConnectApiService);
  private readonly requestId = this.route.snapshot.queryParamMap.get('request') ?? '';
  readonly invalidRequest = signal(!/^[A-Za-z0-9_-]{43}$/.test(this.requestId));
  readonly busy = signal(false);
  readonly approved = signal(false);
  private readonly callbackUrl = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);

  approve(): void {
    if (this.invalidRequest() || this.busy() || this.approved()) return;
    this.busy.set(true);
    this.errorMessage.set(null);
    this.api.approve(this.requestId).subscribe({
      next: ({ redirectUrl }) => {
        this.busy.set(false);
        // The API constructs a fixed deep link; never navigate to arbitrary URLs.
        if (!isExpectedMobileCallback(redirectUrl)) {
          this.errorMessage.set('The mobile callback was rejected.');
          return;
        }
        this.callbackUrl.set(redirectUrl);
        this.approved.set(true);
        window.location.assign(redirectUrl);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.errorMessage.set(this.api.isExpired(error)
          ? 'The request expired or was already used. Restart sign-in on your iPhone.'
          : 'Could not approve sign-in. Please try again.');
      },
    });
  }
  openApp(): void {
    const redirectUrl = this.callbackUrl();
    if (redirectUrl && isExpectedMobileCallback(redirectUrl)) {
      // Explicit user gesture: Safari may refuse a custom-scheme redirect
      // initiated asynchronously after the approval HTTP request.
      window.location.assign(redirectUrl);
    }
  }
}

function isExpectedMobileCallback(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'sportos:' && url.hostname === 'auth' && url.pathname === '/callback'
      && !url.hash && url.searchParams.size === 2
      && /^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('code') ?? '')
      && /^[A-Za-z0-9_-]{32,128}$/.test(url.searchParams.get('state') ?? '');
  } catch {
    return false;
  }
}
