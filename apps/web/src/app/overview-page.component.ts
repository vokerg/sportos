import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'sportos-overview-page',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="card overview-page" aria-labelledby="overview-title">
      <div>
        <span class="page-kicker">Overview</span>
        <h2 id="overview-title">Your training, at a glance</h2>
        <p>Recent scores and selected-day highlights will live here without replacing the complete daily workspace.</p>
      </div>
      <div class="overview-actions">
        <a routerLink="/daily">Open Daily Log</a>
        <a routerLink="/imports">Review imports</a>
      </div>
    </section>
  `,
  styles: [`
    .overview-page { display: flex; align-items: start; justify-content: space-between; gap: 24px; }
    .page-kicker { color: #5368ae; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    h2 { margin: 6px 0; font-size: 30px; }
    p { margin: 0; color: #667085; }
    .overview-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    a { padding: 10px 14px; border-radius: 12px; background: #1d4ed8; color: #fff; font-weight: 650; text-decoration: none; white-space: nowrap; }
    a + a { background: #e4e7ec; color: #344054; }
    @media (max-width: 760px) { .overview-page { display: grid; } }
  `],
})
export class OverviewPageComponent {}
