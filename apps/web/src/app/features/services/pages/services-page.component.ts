import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'sportos-services-page',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="services-page" aria-labelledby="services-title">
      <header class="services-heading">
        <span class="page-kicker">System tools</span>
        <h1 id="services-title">Services</h1>
        <p>Connections and tools for maintaining your SportOS data.</p>
      </header>

      <div class="service-grid">
        <a class="card service-card" routerLink="/providers">
          <span class="service-kind">Connections</span>
          <h2>Providers</h2>
          <p>Connect Strava, sync activities and check sync status.</p>
          <span class="service-link">Open providers <span aria-hidden="true">→</span></span>
        </a>
        <a class="card service-card" routerLink="/imports">
          <span class="service-kind">Data intake</span>
          <h2>Imports</h2>
          <p>Upload workbooks, review import history and inspect diagnostics.</p>
          <span class="service-link">Open imports <span aria-hidden="true">→</span></span>
        </a>
        <a class="card service-card" routerLink="/rules">
          <span class="service-kind">Scoring</span>
          <h2>Rules</h2>
          <p>Review current scoring rules and their version history.</p>
          <span class="service-link">View rules <span aria-hidden="true">→</span></span>
        </a>
        <a class="card service-card" routerLink="/export">
          <span class="service-kind">Data access</span>
          <h2>Export</h2>
          <p>Download a bounded, versioned export of your canonical records.</p>
          <span class="service-link">Open export <span aria-hidden="true">→</span></span>
        </a>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .services-page { max-width: 1100px; margin: 0 auto; }
    .services-heading { margin: 6px 0 24px; }
    .page-kicker { color: var(--link); font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 5px 0; font-size: clamp(28px, 3vw, 40px); letter-spacing: -.035em; }
    .services-heading p { margin: 0; color: var(--text-muted); }
    .service-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .service-card { display: grid; align-content: start; gap: 10px; min-height: 170px; color: var(--text); text-decoration: none; transition: transform .15s ease, box-shadow .15s ease; }
    .service-card:hover { transform: translateY(-2px); box-shadow: 0 16px 36px rgba(20, 33, 61, .14); }
    .service-card:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
    .service-kind { color: var(--link); font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    h2 { margin: 0; font-size: 20px; }
    .service-card p { margin: 0; color: var(--text-muted); line-height: 1.5; }
    .service-link { align-self: end; margin-top: 8px; color: var(--link); font-size: 13px; font-weight: 750; }
    @media (max-width: 680px) { .service-grid { grid-template-columns: 1fr; } .service-card { min-height: 0; } }
    @media (prefers-reduced-motion: reduce) { .service-card { transition: none; } .service-card:hover { transform: none; } }
  `],
})
export class ServicesPageComponent {}
