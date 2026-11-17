import { DOCUMENT } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Component, OnInit, inject, signal } from '@angular/core';
import { NavigationEnd, NavigationSkipped, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { WebAuthService } from './web-auth.service';

@Component({
  selector: 'sportos-root',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <a class="skip-link" href="#main-content">Skip to content</a>

    @if (auth.state() === 'loading') {
      <main class="shell" id="main-content" tabindex="-1">
        <section class="card auth-card" aria-live="polite">
          <h1>SportOS</h1>
          <p>Checking your session…</p>
        </section>
      </main>
    } @else if (auth.state() === 'anonymous') {
      <main class="shell" id="main-content" tabindex="-1">
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
      <main class="shell" id="main-content" tabindex="-1">
        <section class="card auth-card" role="alert">
          <h1>SportOS</h1>
          <p>{{ auth.errorMessage() }}</p>
          <button type="button" (click)="auth.loadSession()">Retry</button>
        </section>
      </main>
    } @else {
      @if (!fullPage()) {
      <header class="app-header" (keydown.escape)="closeMenu(menuButton)">
        <a class="brand" routerLink="/overview" aria-label="SportOS overview">
          <span class="brand-mark" aria-hidden="true">S</span>
          <strong>SportOS</strong>
        </a>
        <button #menuButton class="menu-toggle secondary" type="button" aria-controls="section-menu"
          [attr.aria-expanded]="menuOpen()" (click)="menuOpen.set(!menuOpen())">
          {{ menuOpen() ? 'Close menu' : 'Menu' }}
        </button>
        <div id="section-menu" class="section-menu" [class.open]="menuOpen()">
        <nav aria-label="SportOS sections">
          <a routerLink="/overview" routerLinkActive="active" ariaCurrentWhenActive="page">Overview</a>
          <a routerLink="/daily" routerLinkActive="active" ariaCurrentWhenActive="page">Daily Log</a>
          <a routerLink="/activities" [class.active]="activitiesActive()" [attr.aria-current]="activitiesActive() ? 'page' : null">Activities</a>
          <a routerLink="/heatmap" routerLinkActive="active" ariaCurrentWhenActive="page">Heatmap</a>
          <a routerLink="/dynamics" routerLinkActive="active" ariaCurrentWhenActive="page">Dynamics</a>
          <a routerLink="/stats" [class.active]="statsActive()" [attr.aria-current]="statsActive() ? 'page' : null">Stats</a>
          <a routerLink="/run-lab" routerLinkActive="active" ariaCurrentWhenActive="page">Run Lab</a>
          <a routerLink="/chat" routerLinkActive="active" ariaCurrentWhenActive="page">Chat</a>
          <a routerLink="/services" routerLinkActive="active" ariaCurrentWhenActive="page">Services</a>
        </nav>
        <div class="account-actions">
          <span class="account-name">{{ auth.session()?.account?.displayName }}</span>
          <button type="button" class="secondary" (click)="menuOpen.set(false); auth.signOut()">Sign out</button>
        </div>
        </div>
      </header>
      }
      <main class="page-shell" [class.full-page]="fullPage()" id="main-content" tabindex="-1">
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
    .menu-toggle { display: none; }
    .section-menu { display: contents; }
    nav { display: flex; justify-content: center; gap: 4px; min-width: 0; }
    nav a { padding: 9px 10px; border-radius: 10px; color: var(--text-muted); font-size: 13px; font-weight: 700; text-decoration: none; white-space: nowrap; }
    nav a:hover { background: var(--surface-muted); color: var(--text); }
    nav a.active { background: var(--accent-surface); color: var(--link); box-shadow: inset 0 0 0 1px var(--accent-surface); }
    .account-actions { display: flex; align-items: center; gap: 10px; }
    .account-name { max-width: 170px; overflow: hidden; color: var(--text-muted); font-size: 12px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
    [id="main-content"] { scroll-margin-top: 76px; }
    .page-shell.full-page { padding: 0; }
    .page-shell { padding: 24px clamp(20px, 4vw, 72px) 48px; }
    @media (max-width: 1280px) {
      .app-header { grid-template-columns: minmax(0, 1fr) auto; min-height: 60px; gap: 12px; padding: 8px clamp(12px, 4vw, 48px); }
      .brand { min-height: 44px; justify-self: start; }
      .menu-toggle { display: block; min-height: 44px; }
      .section-menu { display: none; }
      .section-menu.open {
        position: absolute;
        inset: 100% 0 auto;
        display: grid;
        gap: 12px;
        max-height: calc(100dvh - 60px);
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: 12px clamp(12px, 4vw, 48px) max(12px, env(safe-area-inset-bottom));
        border-bottom: 1px solid var(--border);
        background: var(--surface);
        box-shadow: 0 12px 24px rgba(20, 33, 61, .15);
      }
      nav { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
      nav a { display: flex; align-items: center; min-height: 44px; font-size: 15px; white-space: normal; }
      .account-actions { justify-content: space-between; border-top: 1px solid var(--border); padding-top: 12px; }
      .account-actions button { min-height: 44px; }
    }
    @media (max-width: 760px) {
      .page-shell { padding: 14px 12px 32px; }
    }
  `],
})
export class AppComponent implements OnInit {
  readonly fullPage = signal(false);
  readonly menuOpen = signal(false);
  private readonly document = inject(DOCUMENT);

  constructor(readonly auth: WebAuthService, private readonly router: Router) {
    this.router.events.pipe(takeUntilDestroyed()).subscribe(event => {
      if ((event instanceof NavigationEnd || event instanceof NavigationSkipped) && this.menuOpen()) {
        this.menuOpen.set(false);
        this.document.getElementById('main-content')?.focus();
      }
    });
  }

  closeMenu(button: HTMLButtonElement): void {
    if (!this.menuOpen()) return;
    this.menuOpen.set(false);
    button.focus();
  }

  activitiesActive(): boolean {
    return this.router.isActive('/activities', false) || this.router.isActive('/activity', false);
  }

  statsActive(): boolean {
    return this.router.isActive('/stats', false) || this.router.isActive('/monthly-stats', false);
  }

  ngOnInit(): void {
    this.auth.loadSession();
  }
}
