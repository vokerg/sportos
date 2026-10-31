import { Component, OnInit, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { WebAuthService } from './web-auth.service';

@Component({
  selector: 'sportos-root',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <a class="skip-link" href="#main-content">Skip to content</a>

    @if (auth.state() === 'loading') {
      <main class="shell" id="main-content">
        <section class="card auth-card" aria-live="polite">
          <h1>SportOS</h1>
          <p>Checking your session…</p>
        </section>
      </main>
    } @else if (auth.state() === 'anonymous') {
      <main class="shell" id="main-content">
        <section class="card auth-card">
          <h1>SportOS</h1>
          <p>Sign in to access your private training data, provenance, rules, jobs, exports, and read-only analysis.</p>
          @if (auth.loginMode() === 'single-user') {
            <form class="sign-in-form" (submit)="$event.preventDefault(); auth.signInWithPassword(username.value, password.value); password.value = ''">
              <label for="username">Username</label>
              <input #username id="username" name="username" autocomplete="username" required maxlength="100" />
              <label for="password">Password</label>
              <input #password id="password" name="password" type="password" autocomplete="current-password" required maxlength="256" />
              <button type="submit" [disabled]="auth.signingIn()">{{ auth.signingIn() ? 'Signing in…' : 'Sign in' }}</button>
            </form>
          } @else {
            <button type="button" (click)="auth.signIn()">Sign in</button>
          }
          @if (auth.errorMessage()) { <p role="alert">{{ auth.errorMessage() }}</p> }
        </section>
      </main>
    } @else if (auth.state() === 'error') {
      <main class="shell" id="main-content">
        <section class="card auth-card" role="alert">
          <h1>SportOS</h1>
          <p>{{ auth.errorMessage() }}</p>
          <button type="button" (click)="auth.loadSession()">Retry</button>
        </section>
      </main>
    } @else {
      @if (!fullPage()) {
      <header class="app-header">
        <a class="brand" routerLink="/overview" aria-label="SportOS overview">
          <span class="brand-mark" aria-hidden="true">S</span>
          <strong>SportOS</strong>
        </a>
        <nav aria-label="SportOS sections">
          <a routerLink="/overview" routerLinkActive="active" ariaCurrentWhenActive="page">Overview</a>
          <a routerLink="/daily" routerLinkActive="active" ariaCurrentWhenActive="page">Daily Log</a>
          <a routerLink="/activities" routerLinkActive="active" ariaCurrentWhenActive="page">Activities</a>
          <a routerLink="/heatmap" routerLinkActive="active" ariaCurrentWhenActive="page">Heatmap</a>
          <a routerLink="/dynamics" routerLinkActive="active" ariaCurrentWhenActive="page">Dynamics</a>
          <a routerLink="/monthly-stats" routerLinkActive="active" ariaCurrentWhenActive="page">Monthly Stats</a>
          <a routerLink="/run-lab" routerLinkActive="active" ariaCurrentWhenActive="page">Run Lab</a>
          <a routerLink="/chat" routerLinkActive="active" ariaCurrentWhenActive="page">Chat</a>
          <a routerLink="/services" routerLinkActive="active" ariaCurrentWhenActive="page">Services</a>
        </nav>
        <div class="account-actions">
          <span class="account-name">{{ auth.session()?.account?.displayName }}</span>
          <button type="button" class="secondary" (click)="auth.signOut()">Sign out</button>
        </div>
      </header>
      }
      <main class="page-shell" [class.full-page]="fullPage()" id="main-content">
        <router-outlet #outlet="outlet" (activate)="fullPage.set(outlet.activatedRouteData['fullPage'] === true)" (deactivate)="fullPage.set(false)" />
      </main>
    }
  `,
  styles: [`
    .auth-card { max-width: 560px; margin: 10vh auto 0; text-align: center; }
    .sign-in-form { display: grid; gap: 10px; text-align: left; max-width: 340px; margin: 24px auto 0; }
    .sign-in-form input { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; font: inherit; }
    .sign-in-form button { margin-top: 10px; }
    .app-header {
      position: sticky;
      top: 0;
      z-index: 100;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 22px;
      min-height: 72px;
      padding: 10px clamp(20px, 4vw, 72px);
      border-bottom: 1px solid var(--border);
      background: var(--surface-glass);
      box-shadow: 0 4px 18px rgba(20, 33, 61, .05);
      backdrop-filter: blur(12px);
    }
    .brand { display: inline-flex; align-items: center; gap: 10px; color: var(--text); font-size: 20px; text-decoration: none; }
    .brand-mark { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 11px; background: var(--primary); color: var(--on-primary); font-weight: 850; }
    nav { display: flex; justify-content: center; gap: 4px; min-width: 0; overflow-x: auto; scrollbar-width: thin; }
    nav a { padding: 9px 10px; border-radius: 10px; color: var(--text-muted); font-size: 13px; font-weight: 700; text-decoration: none; white-space: nowrap; }
    nav a:hover { background: var(--surface-muted); color: var(--text); }
    nav a.active { background: var(--accent-surface); color: var(--link); box-shadow: inset 0 0 0 1px var(--accent-surface); }
    .account-actions { display: flex; align-items: center; gap: 10px; }
    .account-name { max-width: 170px; overflow: hidden; color: var(--text-muted); font-size: 12px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
    .page-shell.full-page { padding: 0; }
    .page-shell { padding: 24px clamp(20px, 4vw, 72px) 48px; }
    @media (max-width: 1180px) {
      .app-header { grid-template-columns: auto minmax(0, 1fr); }
      nav { justify-content: flex-start; }
      .account-actions { display: none; }
    }
    @media (max-width: 760px) {
      .app-header { grid-template-columns: 1fr; gap: 8px; padding: 10px 12px; }
      nav { justify-content: flex-start; }
      .page-shell { padding: 14px 12px 32px; }
    }
  `],
})
export class AppComponent implements OnInit {
  readonly fullPage = signal(false);
  constructor(readonly auth: WebAuthService) {}

  ngOnInit(): void {
    this.auth.loadSession();
  }
}
