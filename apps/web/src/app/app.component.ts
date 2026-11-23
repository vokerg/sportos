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
            <button type="button" (click)="auth.signIn()">{{ auth.loginMode() === 'single-user-google' ? 'Sign in with Google' : 'Sign in' }}</button>
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
          [attr.aria-expanded]="menuOpen()" (click)="toggleMenu(menuButton)">
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
            @if (auth.googleEnrollment()) {
              <button type="button" class="secondary" [disabled]="auth.linkingGoogle()" (click)="auth.enrollGoogle()">Link Google account</button>
            }
            <button type="button" class="secondary" (click)="menuOpen.set(false); auth.signOut()">Sign out</button>
          </div>
        </div>
      </header>
      <div class="mobile-navigation" (keydown.escape)="closeMenu(mobileMoreButton)">
        <nav class="mobile-tab-bar" aria-label="Primary navigation">
          <a routerLink="/overview" routerLinkActive="active" ariaCurrentWhenActive="page">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/></svg>
            <span>Home</span>
          </a>
          <a routerLink="/daily" routerLinkActive="active" ariaCurrentWhenActive="page">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 14h3m3 0h3m-9 3h3"/></svg>
            <span>Daily</span>
          </a>
          <a routerLink="/activities" [class.active]="activitiesActive()" [attr.aria-current]="activitiesActive() ? 'page' : null">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12h4l3-6 4 12 3-6h6"/></svg>
            <span>Activities</span>
          </a>
          <a routerLink="/run-lab" routerLinkActive="active" ariaCurrentWhenActive="page">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V4M4 20h16M7 15l5-5 3 2 5-6"/></svg>
            <span>Run Lab</span>
          </a>
          <button #mobileMoreButton type="button" [class.active]="menuOpen() || moreActive()"
            aria-haspopup="dialog" aria-controls="mobile-more-panel"
            [attr.aria-expanded]="menuOpen()" (click)="toggleMobileMenu(mobileMoreButton)">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
            <span>More</span>
          </button>
        </nav>
        @if (menuOpen()) {
          <button type="button" class="mobile-menu-scrim" aria-label="Close navigation menu" (click)="closeMenu(mobileMoreButton)"></button>
          <section id="mobile-more-panel" class="mobile-more-panel" role="dialog" aria-modal="true" aria-label="More sections"
            (keydown.tab)="trapMobileMenuFocus($event)">
            <div class="more-heading"><h2>More</h2><button type="button" class="secondary" (click)="closeMenu(mobileMoreButton)">Done</button></div>
            <nav class="more-links" aria-label="Additional navigation">
              <a routerLink="/heatmap" routerLinkActive="active" ariaCurrentWhenActive="page">Heatmap</a>
              <a routerLink="/dynamics" routerLinkActive="active" ariaCurrentWhenActive="page">Dynamics</a>
              <a routerLink="/stats" [class.active]="statsActive()" [attr.aria-current]="statsActive() ? 'page' : null">Stats</a>
              <a routerLink="/chat" routerLinkActive="active" ariaCurrentWhenActive="page">Chat</a>
              <a routerLink="/services" routerLinkActive="active" ariaCurrentWhenActive="page">Services</a>
            </nav>
            <div class="mobile-account">
              <span>{{ auth.session()?.account?.displayName }}</span>
              @if (auth.googleEnrollment()) {
                <button type="button" class="secondary" [disabled]="auth.linkingGoogle()" (click)="auth.enrollGoogle()">Link Google account</button>
              }
              <button type="button" class="secondary" (click)="menuOpen.set(false); auth.signOut()">Sign out</button>
            </div>
          </section>
        }
      </div>
      }
      <main class="page-shell" [class.full-page]="fullPage()" id="main-content" tabindex="-1">
        @if (auth.googleEnrollment() && auth.errorMessage()) { <p role="alert">{{ auth.errorMessage() }}</p> }
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
    .mobile-navigation { display: none; }
    .section-menu { display: contents; }
    .section-menu nav { display: flex; justify-content: center; gap: 4px; min-width: 0; }
    .section-menu nav a { padding: 9px 10px; border-radius: 10px; color: var(--text-muted); font-size: 13px; font-weight: 700; text-decoration: none; white-space: nowrap; }
    .section-menu nav a:hover { background: var(--surface-muted); color: var(--text); }
    .section-menu nav a.active { background: var(--accent-surface); color: var(--link); box-shadow: inset 0 0 0 1px var(--accent-surface); }
    .account-actions { display: flex; align-items: center; gap: 10px; }
    .account-name { max-width: 170px; overflow: hidden; color: var(--text-muted); font-size: 12px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
    [id="main-content"] { scroll-margin-top: 76px; }
    .page-shell.full-page { padding: 0; }
    .page-shell { box-sizing: border-box; width: 100%; min-width: 0; padding: 24px clamp(20px, 4vw, 72px) 48px; }
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
      .section-menu nav { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
      .section-menu nav a { display: flex; align-items: center; min-height: 44px; font-size: 15px; white-space: normal; }
      .account-actions { justify-content: space-between; border-top: 1px solid var(--border); padding-top: 12px; }
      .account-actions button { min-height: 44px; }
    }
    @media (max-width: 760px) {
      .app-header { padding: 8px max(16px, env(safe-area-inset-right)) 8px max(16px, env(safe-area-inset-left)); }
      .menu-toggle, .section-menu, .section-menu.open { display: none; }
      .mobile-navigation { display: block; }
      .mobile-tab-bar {
        position: fixed; z-index: 130; inset: auto 0 0; display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 2px;
        box-sizing: border-box; width: 100%;
        padding: 6px max(8px, env(safe-area-inset-right)) calc(6px + env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left));
        border-top: 1px solid var(--border); background: var(--surface-glass);
        box-shadow: 0 -6px 20px rgba(20, 33, 61, .08); backdrop-filter: blur(16px);
      }
      .mobile-tab-bar > a, .mobile-tab-bar > button {
        display: grid; justify-items: center; align-content: center; gap: 3px;
        box-sizing: border-box; min-width: 0; min-height: 54px; padding: 5px 2px;
        border: 0; border-radius: 12px; background: transparent; color: var(--text-muted);
        font: inherit; font-size: 10px; font-weight: 700; text-decoration: none;
      }
      .mobile-tab-bar svg { display: block; width: 24px; height: 24px; }
      .mobile-tab-bar .active { background: var(--accent-surface); color: var(--link); }
      .mobile-menu-scrim { position: fixed; z-index: 120; inset: 0; width: 100%; border-radius: 0; background: rgba(9, 18, 34, .45); }
      .mobile-more-panel {
        position: fixed; z-index: 125; left: max(12px, env(safe-area-inset-left)); right: max(12px, env(safe-area-inset-right));
        bottom: calc(76px + env(safe-area-inset-bottom)); max-height: calc(100dvh - 110px - env(safe-area-inset-bottom));
        box-sizing: border-box; overflow-y: auto; overscroll-behavior: contain;
        padding: 18px; border-radius: 20px; background: var(--surface); box-shadow: 0 16px 48px rgba(9, 18, 34, .23);
      }
      .more-heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 8px; }
      .more-heading h2 { margin: 0; font-size: 20px; }
      .more-heading button { min-height: 44px; }
      .more-links { display: grid; }
      .more-links a { display: flex; align-items: center; min-height: 48px; padding: 0 12px; border-bottom: 1px solid var(--border); color: var(--text); font-weight: 650; text-decoration: none; }
      .more-links a.active { color: var(--link); background: var(--accent-surface); }
      .mobile-account { display: grid; gap: 10px; padding-top: 18px; }
      .mobile-account span { min-width: 0; overflow-wrap: anywhere; color: var(--text-muted); font-size: 13px; font-weight: 650; }
      .mobile-account button { min-height: 44px; }
      .page-shell {
        padding: 16px max(16px, env(safe-area-inset-right))
          calc(112px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
      }
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
        this.document.getElementById('main-content')?.focus({ preventScroll: true });
        this.document.defaultView?.scrollTo({ top: 0, behavior: 'instant' });
      }
    });
  }

  toggleMenu(button: HTMLButtonElement): void {
    this.menuOpen.update(open => !open);
    button.focus();
  }

  closeMenu(button: HTMLButtonElement): void {
    if (!this.menuOpen()) return;
    this.menuOpen.set(false);
    button.focus();
  }

  toggleMobileMenu(button: HTMLButtonElement): void {
    if (this.menuOpen()) {
      this.closeMenu(button);
      return;
    }
    this.menuOpen.set(true);
    this.document.defaultView?.requestAnimationFrame(() => {
      this.document.querySelector<HTMLElement>('#mobile-more-panel .more-links a')?.focus();
    });
  }

  trapMobileMenuFocus(event: KeyboardEvent): void {
    const panel = this.document.getElementById('mobile-more-panel');
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && this.document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && this.document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  activitiesActive(): boolean {
    return this.router.isActive('/activities', false) || this.router.isActive('/activity', false);
  }

  statsActive(): boolean {
    return this.router.isActive('/stats', false) || this.router.isActive('/monthly-stats', false);
  }

  moreActive(): boolean {
    return ['/heatmap', '/dynamics', '/stats', '/monthly-stats', '/chat', '/services']
      .some(path => this.router.isActive(path, false));
  }

  ngOnInit(): void {
    this.auth.loadSession();
  }
}
