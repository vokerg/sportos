import { Component, input, output } from '@angular/core';
import type { DailyRunStepCalculation, DailyScoreBreakdown, DailyStepsCalculation } from './score-breakdown.models';
import { formatDistance, formatDuration, formatNumber } from './score-breakdown.view-model';

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
        <div><span>Steps</span><strong>{{ formatNumber(current.facts.steps) }}</strong><small>{{ stepsSource(current.facts.stepsCalculation) }}</small></div>
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
      </div>
      @if (current.facts.stepsCalculation?.source === 'garmin_adjusted') {
        <div class="steps-calculation">
          <strong>{{ garminEquation(current.facts.stepsCalculation!) }}</strong>
          @if ((current.facts.stepsCalculation!.runs?.length ?? 0) > 0) {
            <ul>
              @for (run of current.facts.stepsCalculation!.runs; track run.activityId ?? $index) {
                <li>{{ runEquation(run) }}</li>
              }
            </ul>
          }
          @if ((current.facts.stepsCalculation!.unestimatedRunCount ?? 0) > 0) {
            <small>{{ current.facts.stepsCalculation!.unestimatedRunCount }} run(s) lacked enough timing data for a deduction.</small>
          }
        </div>
      }
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
    .facts-grid small { color: #667085; font-size: 10px; line-height: 1.35; }
    .steps-calculation { margin-top: 10px; padding: 11px 12px; border: 1px solid #f0d9ad; border-radius: 10px; background: #fffaf0; color: #7a4b00; font-size: 12px; }
    .steps-calculation ul { display: grid; gap: 4px; margin: 7px 0 0; padding-left: 18px; color: #667085; }
    .steps-calculation small { display: block; margin-top: 7px; color: #8a5a13; }
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
  readonly formatDuration = formatDuration;
  readonly formatNumber = formatNumber;

  stepsSource(calculation?: DailyStepsCalculation): string {
    if (!calculation) return '';
    if (calculation.source === 'manual') return 'Manual value; recalculation preserves it';
    if (calculation.source === 'imported') return 'Imported value; recalculation preserves it';
    if (calculation.source === 'stored') return 'Existing value preserved';
    if (calculation.source === 'garmin_adjusted') return 'Garmin total after running-step deduction';
    return '';
  }

  garminEquation(calculation: DailyStepsCalculation): string {
    return `Garmin ${formatNumber(calculation.garminTotalSteps ?? 0)} − running ${formatNumber(calculation.estimatedRunningSteps ?? 0)} = ${formatNumber(calculation.resolvedSteps)} steps`;
  }

  runEquation(run: DailyRunStepCalculation): string {
    const cadenceSource = run.cadenceSource === 'strava_cadence' ? 'Strava cadence' : 'pace estimate';
    const distance = run.distanceM === undefined ? 'run' : formatDistance(run.distanceM);
    return `${distance} · ${formatNumber(run.cadenceSpm)} spm (${cadenceSource}) × ${formatDuration(run.movingTimeS)} = ${formatNumber(run.estimatedSteps)} steps`;
  }
}
