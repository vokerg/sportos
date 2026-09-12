import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'sportos-daily-detail-page',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="card">
      <a routerLink="/daily">← Back to Daily Log</a>
      <h2>Daily score</h2>
      <p>The complete score, edit controls, activities, raw provenance, and ledger will be preserved on this route.</p>
    </section>
  `,
})
export class DailyDetailPageComponent {}
