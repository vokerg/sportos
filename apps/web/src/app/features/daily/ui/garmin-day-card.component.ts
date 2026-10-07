import { Component, OnChanges, inject, input } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { GarminDayStore } from '../state/garmin-day.store';
import { GARMIN_CATEGORY_LABELS, type GarminDayCategoryState, type GarminDayEvidence } from '../model/garmin-day.models';
@Component({
  selector: 'sportos-garmin-day-card', standalone: true, imports: [DatePipe, DecimalPipe, RouterLink], providers: [GarminDayStore],
  template: `
    <section class="garmin-day" aria-label="Garmin day evidence" [attr.aria-busy]="store.loading() || store.fetching()">
      <h2>Garmin evidence for {{ date() }}</h2>
      <p>Evidence only. Fetching does not recalculate this day or change official scores or Strava activity facts.</p>
      @if (store.loading()) { <p role="status">Reading retained coverage…</p> }
      @if (store.data(); as day) {
        <p role="status">{{ day.state === 'missing' ? 'Not fetched' : day.state === 'partial' ? 'Partial — some categories need another attempt' : 'Current retained evidence' }}
          @if (day.result === 'cached') { · Reused retained data }
          @if (store.fetching()) { · Fetching from Garmin… }</p>
        <div class="actions">
          <button type="button" (click)="store.fetch()" [disabled]="!day.fetchEnabled || store.fetching()">{{ day.state === 'partial' ? 'Retry missing Garmin data' : 'Fetch Garmin day' }}</button>
          <button type="button" (click)="store.view()" [disabled]="day.state === 'missing'">{{ store.expanded() ? 'Hide Garmin data' : 'View retained Garmin data' }}</button>
          <button type="button" (click)="store.fetch(true)" [disabled]="!day.fetchEnabled || day.state === 'missing' || store.fetching()">Refresh from Garmin</button>
        </div>
        @if (!day.fetchEnabled) { <p>Downloads require the enabled local helper. Retained evidence is still available to view.</p> }
        @if (store.expanded()) {
          <div class="categories">
            @for (item of day.categories; track item.category) {
              <article>
                <h3>{{ labels[item.category] }}</h3>
                <p>{{ status(item.state) }}</p>
                @if (item.retainedAt) { <p class="muted">Retained {{ item.retainedAt | date:'medium' }} · Garmin Connect · {{ day.date }}</p> }
                @if (item.attemptedAt && item.state !== 'available') { <p class="muted">Last attempt {{ item.attemptedAt | date:'medium' }}</p> }
                @if (item.retainedAt && ['failed', 'authentication_required', 'rate_limited'].includes(item.state)) { <p>Showing the previous retained version.</p> }
                @if (item.evidence; as evidence) {
                  @if (item.category === 'weight') {
                    @for (measurement of evidence.measurements ?? []; track $index) {
                      <div class="measurement">
                        <strong>Measurement {{ $index + 1 }}</strong>
                        <span>{{ measurement.recordedAt ? (measurement.recordedAt | date:'medium') : 'Source timestamp not recorded' }}</span>
                        <dl>
                          <dt>Weight</dt><dd>{{ measurement.weightKg === null ? 'Not recorded' : (measurement.weightKg | number:'1.1-3') + ' kg' }}</dd>
                          <dt>BMI</dt><dd>{{ measurement.bmi ?? 'Not recorded' }}</dd>
                          <dt>Body fat</dt><dd>{{ measurement.bodyFatPct === null ? 'Not recorded' : measurement.bodyFatPct + ' %' }}</dd>
                          <dt>Skeletal muscle mass</dt><dd>{{ measurement.muscleMassKg === null ? 'Not recorded' : measurement.muscleMassKg + ' kg' }}</dd>
                          <dt>Bone mass</dt><dd>{{ measurement.boneMassKg === null ? 'Not recorded' : measurement.boneMassKg + ' kg' }}</dd>
                          <dt>Body water</dt><dd>{{ measurement.bodyWaterPct === null ? 'Not recorded' : measurement.bodyWaterPct + ' %' }}</dd>
                        </dl>
                      </div>
                    }
                  } @else if (item.category === 'activities') {
                    <p>{{ evidence.count ?? 0 }} activities · {{ evidence.complete ? 'Complete bounded discovery' : 'Discovery incomplete; retry or review required' }}</p>
                    <ul>@for (activity of evidence.activities ?? []; track activity.ordinal) {
                      <li>Activity {{ activity.ordinal }} · {{ activity.reconciliation }} · {{ activity.resourceState }}
                        @if (activity.activityId) { <a [routerLink]="['/activity', activity.activityId]">View linked activity</a> }
                      </li>
                    }</ul>
                  } @else {
                    <dl>@for (metric of metricRows(evidence); track metric.key) { <dt>{{ metric.label }}</dt><dd>{{ metric.value }}</dd> }</dl>
                  }
                }
                @if (item.resourceAvailable) { <button type="button" class="resource" (click)="store.resource(item.category)" [disabled]="store.resourceLoading() || store.fetching()">Inspect retained {{ labels[item.category] }} resource</button> }
              </article>
            }
          </div>
          @if (store.resourceLoading()) { <p role="status">Reading retained resource…</p> }
          @if (store.resourceError()) { <p role="alert">{{ store.resourceError() }}</p> }
          @if (store.resourceJson(); as raw) { <details open><summary>Advanced Garmin resource — source evidence</summary><pre>{{ raw }}</pre></details> }
        }
      }
      @if (store.error()) { <p class="error" role="alert">{{ store.error() }}</p>
        @if (!store.data()) { <button type="button" (click)="store.load(date())">Retry loading</button> }
      }
    </section>
  `,
  styles: [`
    .garmin-day { border: 1px solid #dbe4f5; border-radius: 12px; padding: 16px; margin-bottom: 12px; background: #f8faff; }
    h2 { font-size: 16px; margin: 0 0 8px; } h3 { font-size: 14px; margin: 0; }
    p { font-size: 13px; margin: 6px 0; } .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
    .categories { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: 12px; margin-top: 12px; }
    article { background: white; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; min-width: 0; }
    dl { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; font-size: 13px; } dd { margin: 0; } .muted { color: #667085; font-size: 11px; }
    .measurement { border-top: 1px solid #e2e8f0; margin-top: 8px; padding-top: 8px; } .measurement span { display: block; font-size: 12px; }
    .error { color: #b54747; } pre { max-height: 360px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; }
    .resource { font-size: 12px; } ul { padding-left: 16px; font-size: 13px; } a { margin-left: 6px; }
  `],
})
export class GarminDayCardComponent implements OnChanges {
  readonly date = input.required<string>();
  readonly store = inject(GarminDayStore); readonly labels = GARMIN_CATEGORY_LABELS;
  ngOnChanges() { if (this.date()) this.store.load(this.date()); }
  status(state: GarminDayCategoryState): string {
    return { missing: 'Not fetched', available: 'Available', not_recorded: 'Not recorded for this date', unsupported: 'Unsupported by this endpoint/device', private: 'Private in Garmin', failed: 'Failed — retry available', authentication_required: 'Authentication required — run pnpm garmin:login locally', rate_limited: 'Rate limited — retry later' }[state];
  }
  metricRows(evidence: GarminDayEvidence) {
    return Object.entries(evidence).filter(([,value]) => typeof value === 'number' || value === null).map(([key,value]) => {
      const entry = METRICS[key]; return { key, label: entry?.[0] ?? key, value: value === null ? 'Not recorded' : `${value}${entry?.[1] ?? ''}` };
    });
  }
}
const METRICS: Record<string, [string,string]> = {
  steps: ['All-day steps',''], distanceM: ['Distance',' m'], totalCalories: ['Total calories',' kcal'], activeCalories: ['Active calories',' kcal'], restingCalories: ['Resting calories',' kcal'], floorsClimbed: ['Floors climbed',''], floorsDescended: ['Floors descended',''], moderateIntensityMinutes: ['Moderate intensity',' min'], vigorousIntensityMinutes: ['Vigorous intensity',' min'],
  sleepSeconds: ['Sleep',' s'], deepSleepSeconds: ['Deep sleep',' s'], lightSleepSeconds: ['Light sleep',' s'], remSleepSeconds: ['REM sleep',' s'], awakeSeconds: ['Awake',' s'], napSeconds: ['Naps',' s'], restingBpm: ['Resting heart rate',' bpm'], minBpm: ['Minimum heart rate',' bpm'], maxBpm: ['Maximum heart rate',' bpm'], lastNightAvgMs: ['Last night HRV average',' ms'], lastNightHighMs: ['Last night HRV high',' ms'], weeklyAvgMs: ['Weekly HRV average',' ms'], averageLevel: ['Average stress',''], maxLevel: ['Maximum stress',''], charged: ['Body Battery charged',''], drained: ['Body Battery drained',''],
};
