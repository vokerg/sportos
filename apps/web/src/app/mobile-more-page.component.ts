import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { WebAuthService } from './web-auth.service';

/** Matches the native app's More destination while retaining web-only sections. */
@Component({
  selector: 'sportos-mobile-more-page',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="more-page" aria-labelledby="more-title">
      <header>
        <span class="eyebrow">SPORTOS</span>
        <h1 id="more-title">More</h1>
      </header>
      <section class="more-group" aria-labelledby="explore-title">
        <h2 id="explore-title">Explore</h2>
        <nav aria-label="More sections">
          <a routerLink="/heatmap">
            <span><strong>Your map</strong><small>Heatmap of the ground you covered</small></span>
            <span class="chevron" aria-hidden="true">›</span>
          </a>
          <a routerLink="/dynamics">
            <span><strong>Training dynamics</strong><small>Rolling volume and training rhythm</small></span>
            <span class="chevron" aria-hidden="true">›</span>
          </a>
          <a routerLink="/stats">
            <span><strong>Stats</strong><small>Monthly totals and pace trends</small></span>
            <span class="chevron" aria-hidden="true">›</span>
          </a>
          <a routerLink="/chat">
            <span><strong>Chat</strong><small>Explore your training data</small></span>
            <span class="chevron" aria-hidden="true">›</span>
          </a>
          <a routerLink="/services">
            <span><strong>Services</strong><small>Providers, imports, scoring and exports</small></span>
            <span class="chevron" aria-hidden="true">›</span>
          </a>
        </nav>
      </section>
      <section class="more-group account-group" aria-labelledby="account-title">
        <h2 id="account-title">{{ auth.session()?.account?.displayName || 'SportOS account' }}</h2>
        <p>Private account</p>
        @if (auth.googleEnrollment()) {
          <button type="button" class="secondary" [disabled]="auth.linkingGoogle()" (click)="auth.enrollGoogle()">Link Google account</button>
        }
        <button type="button" class="secondary" (click)="auth.signOut()">Sign out</button>
      </section>
    </section>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .more-page { max-width: 740px; margin: 0 auto; }
    header { margin: 8px 0 24px; }
    .eyebrow { color: var(--link); font-size: 11px; font-weight: 800; letter-spacing: .12em; }
    h1 { margin: 6px 0 0; font-size: clamp(28px, 5vw, 38px); letter-spacing: -.035em; }
    .more-group { margin-bottom: 16px; padding: 16px; border-radius: 18px; background: var(--surface); box-shadow: 0 8px 28px rgba(20, 33, 61, .06); }
    h2 { margin: 0 0 12px; color: var(--text-secondary); font-size: 14px; font-weight: 750; }
    nav { display: grid; }
    nav a { display: flex; justify-content: space-between; align-items: center; min-height: 62px; gap: 12px; padding: 9px 4px; color: var(--text); text-decoration: none; }
    nav a + a { border-top: 1px solid var(--border); }
    nav a strong, nav a small { display: block; }
    nav a strong { font-size: 16px; font-weight: 700; }
    nav a small { margin-top: 3px; color: var(--text-muted); font-size: 12px; line-height: 1.45; }
    nav a:hover strong { color: var(--link); }
    .chevron { color: var(--text-muted); font-size: 26px; }
    .account-group p { margin: 0 0 12px; color: var(--text-muted); font-size: 13px; }
    .account-group button { min-height: 44px; margin: 4px 8px 4px 0; }
    @media (max-width: 760px) {
      header { margin-top: 2px; }
      .more-group { padding: 14px; border-radius: 16px; }
    }
  `],
})
export class MobileMorePageComponent {
  readonly auth = inject(WebAuthService);
}
