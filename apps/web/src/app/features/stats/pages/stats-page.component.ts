import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'sportos-stats-page',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="stats-page" aria-labelledby="stats-title">
      <header>
        <span class="page-kicker">Training reports</span>
        <h1 id="stats-title">Stats</h1>
        <p>Explore your training over time.</p>
      </header>

      <div class="report-grid">
        <a class="card report-card" routerLink="/monthly-stats">
          <span class="page-kicker">Monthly overview</span>
          <h2>Monthly Stats</h2>
          <p>Review monthly totals, recorded-day averages and training trends.</p>
          <span class="report-link">Open monthly stats <span aria-hidden="true">→</span></span>
        </a>
        <a class="card report-card" routerLink="/stats/average-pace">
          <span class="page-kicker">Coming soon</span>
          <h2>Average Pace / Speed</h2>
          <p>Running pace or cycling speed. A new report is on the way.</p>
          <span class="report-link">View placeholder <span aria-hidden="true">→</span></span>
        </a>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .stats-page { max-width: 1100px; margin: 0 auto; }
    header { margin: 6px 0 24px; }
    .page-kicker { color: var(--link); font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 5px 0; font-size: clamp(28px, 3vw, 40px); letter-spacing: -.035em; }
    p { margin: 0; color: var(--text-muted); line-height: 1.5; }
    .report-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .report-card { display: grid; align-content: start; gap: 10px; min-height: 170px; color: var(--text); text-decoration: none; }
    .report-card:hover { box-shadow: 0 16px 36px rgba(20, 33, 61, .14); }
    .report-card:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
    h2 { margin: 0; font-size: 20px; }
    .report-link { align-self: end; margin-top: 8px; color: var(--link); font-size: 13px; font-weight: 750; }
    @media (max-width: 680px) { .report-grid { grid-template-columns: 1fr; } .report-card { min-height: 0; } }
  `],
})
export class StatsPageComponent {}
