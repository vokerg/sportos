import { Component, input, output } from '@angular/core';
import type { DailyScoreBreakdown } from './score-breakdown.models';
import { formatDistance, formatNumber } from './score-breakdown.view-model';

@Component({
  selector: 'sportos-score-breakdown-facts',
  standalone: true,
  template: `
    @let current = breakdown();
    <section class="facts-section" aria-labelledby="daily-facts-title">
      <div class="section-heading">
        <div>
          <span class="section-label">Canonical facts</span>
          <h4 id="daily-facts-title">Everything SportOS used for this day</h4>
        </div>
        <button type="button" class="secondary-button" (click)="edit.emit()">Edit facts</button>
      </div>
      <div class="facts-grid">
        <div><span>Steps</span><strong>{{ formatNumber(current.facts.steps) }}</strong></div>
        <div><span>Run</span><strong>{{ formatDistance(current.facts.runM) }}</strong></div>
        <div><span>Run · treadmill</span><strong>{{ formatDistance(current.facts.runIndoorM) }}</strong></div>
        <div><span>Run · outdoor</span><strong>{{ formatDistance(current.facts.runOutdoorM) }}</strong></div>
        <div><span>Run · unspecified</span><strong>{{ formatDistance(current.facts.runUnspecifiedM) }}</strong></div>
        <div><span>Bike</span><strong>{{ formatDistance(current.facts.bikeM) }}</strong></div>
        <div><span>Bike · indoor</span><strong>{{ formatDistance(current.facts.bikeIndoorM) }}</strong></div>
        <div><span>Bike · outdoor</span><strong>{{ formatDistance(current.facts.bikeOutdoorM) }}</strong></div>
        <div><span>Bike · unspecified</span><strong>{{ formatDistance(current.facts.bikeUnspecifiedM) }}</strong></div>
        <div><span>Swim</span><strong>{{ formatDistance(current.facts.swimM, 0) }}</strong></div>
        <div><span>Workout points</span><strong>{{ formatNumber(current.facts.workoutPoints) }}</strong></div>
        <div><span>Power points</span><strong>{{ formatNumber(current.facts.powerPoints) }}</strong></div>
      </div>
    </section>
  `,
  styles: [`
    .facts-section { margin: 22px 0; }
    .section-heading {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 10px;
    }
    .section-heading h4 { margin: 3px 0 0; color: #172b4d; font-size: 17px; }
    .section-label {
      color: #667085;
      font-size: 11px;
      font-weight: 750;
      letter-spacing: .06em;
      text-transform: uppercase;
    }
    .secondary-button { background: white; color: #40558f; border: 1px solid #cbd6ed; box-shadow: none; }
    .facts-grid {
      display: grid;
      grid-template-columns: repeat(6, minmax(100px, 1fr));
      gap: 8px;
    }
    .facts-grid > div {
      display: grid;
      gap: 5px;
      padding: 11px 12px;
      border: 1px solid #e1e7f0;
      border-radius: 10px;
      background: #fff;
    }
    .facts-grid span { color: #667085; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
    .facts-grid strong { color: #172b4d; font-size: 16px; }
    @media (max-width: 900px) { .facts-grid { grid-template-columns: repeat(3, minmax(100px, 1fr)); } }
    @media (max-width: 680px) {
      .facts-grid { grid-template-columns: repeat(2, minmax(100px, 1fr)); }
      .section-heading { flex-direction: column; }
    }
  `],
})
export class ScoreBreakdownFactsComponent {
  readonly breakdown = input.required<DailyScoreBreakdown>();
  readonly edit = output<void>();

  readonly formatDistance = formatDistance;
  readonly formatNumber = formatNumber;
}
