import { Component, input } from '@angular/core';
import { formatDate } from './date-time';
import type { GarminObservation, JsonValue } from './score-breakdown.models';

interface GarminMetricRow {
  label: string;
  value: string;
}

const METRIC_LABELS: Record<string, string> = {
  periodLabel: 'Period',
  steps: 'Steps',
  distanceKm: 'Distance',
  totalCalories: 'Total calories',
  activeCalories: 'Active calories',
  restingCalories: 'Resting calories',
  averageDailyTotal: 'Average daily calories',
  climbedFloors: 'Floors climbed',
  descendedFloors: 'Floors descended',
  weightKg: 'Weight',
  changeKg: 'Weight change',
  bmi: 'BMI',
  bodyFatPercent: 'Body fat',
  skeletalMuscleMassKg: 'Skeletal muscle mass',
  boneMassKg: 'Bone mass',
  bodyWaterPercent: 'Body water',
};

@Component({
  selector: 'sportos-score-breakdown-garmin',
  standalone: true,
  template: `
    @if (observations().length > 0) {
      <section class="data-section" aria-labelledby="garmin-observations-title">
        <div class="section-heading">
          <div>
            <span class="section-label">Dated Garmin evidence</span>
            <h4 id="garmin-observations-title">Garmin observations for this date</h4>
            <p class="section-help">Every value retains its source row. Exact Daily summary steps can feed an explicit recalculation; weekly and body-composition reports remain context only.</p>
          </div>
          <strong class="count-badge">{{ observations().length }}</strong>
        </div>
        <div class="observation-list">
          @for (observation of observations(); track observation.id) {
            <article class="observation-card">
              <header>
                <div>
                  <span class="garmin-badge">Garmin</span>
                  <strong>{{ reportLabel(observation) }}</strong>
                </div>
                <span class="observation-date">{{ dateLabel(observation) }}</span>
              </header>
              <dl>
                @for (metric of metrics(observation); track metric.label) {
                  <div><dt>{{ metric.label }}</dt><dd>{{ metric.value }}</dd></div>
                }
              </dl>
              <p class="source-line">
                {{ observation.sourceRecord.batch.filename || 'Garmin CSV' }} ·
                {{ observation.sourceRecord.sheetName || observation.reportType }} ·
                row {{ observation.sourceRecord.rowIndex ?? 'unknown' }}
              </p>
            </article>
          }
        </div>
      </section>
    }
  `,
  styles: [`
    .data-section { margin: 22px 0; }
    .section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
    .section-heading h4 { margin: 3px 0 0; color: #172b4d; font-size: 17px; }
    .section-label { color: #8a5a12; font-size: 11px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
    .section-help { max-width: 760px; margin: 5px 0 0; color: #667085; font-size: 12px; line-height: 1.45; }
    .count-badge { flex: 0 0 auto; padding: 5px 9px; border-radius: 999px; background: #fff4dc; color: #8a5a12; font-size: 12px; }
    .observation-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; }
    .observation-card { padding: 13px; border: 1px solid #eadcbf; border-radius: 12px; background: #fffdf8; }
    .observation-card header, .observation-card header div { display: flex; align-items: center; gap: 8px; }
    .observation-card header { justify-content: space-between; }
    .observation-card header strong { color: #344054; font-size: 13px; }
    .garmin-badge { padding: 3px 6px; border-radius: 999px; background: #e8f4ff; color: #1769aa; font-size: 9px; font-weight: 800; text-transform: uppercase; }
    .observation-date { color: #667085; font-size: 11px; white-space: nowrap; }
    dl { display: grid; gap: 6px; margin: 12px 0 0; }
    dl div { display: flex; justify-content: space-between; gap: 16px; padding-top: 6px; border-top: 1px solid #f1e8d5; }
    dt { color: #667085; font-size: 11px; }
    dd { margin: 0; color: #172b4d; font-size: 12px; font-weight: 700; text-align: right; }
    .source-line { margin: 11px 0 0; color: #7a6d59; font-size: 10px; overflow-wrap: anywhere; }
    @media (max-width: 680px) { .section-heading { flex-direction: column; } }
  `],
})
export class ScoreBreakdownGarminComponent {
  readonly observations = input.required<GarminObservation[]>();

  reportLabel(observation: GarminObservation): string {
    if (observation.reportType === 'daily_summary') return 'Daily summary';
    if (observation.reportType === 'steps_weekly') return 'Weekly steps';
    if (observation.reportType === 'calories_weekly') return 'Weekly calories';
    if (observation.reportType === 'floors_weekly') return 'Weekly floors';
    return 'Weight and body composition';
  }

  dateLabel(observation: GarminObservation): string {
    const prefix = observation.reportType.endsWith('_weekly') ? 'Week ending ' : '';
    const time = observation.recordedTime ? ` · ${observation.recordedTime.slice(0, 5)}` : '';
    return `${prefix}${formatDate(observation.recordedDate)}${time}`;
  }

  metrics(observation: GarminObservation): GarminMetricRow[] {
    const values = jsonRecord(observation.values);
    return Object.entries(values)
      .filter(([, value]) => value !== null)
      .map(([key, value]) => ({ label: METRIC_LABELS[key] ?? humanize(key), value: metricValue(key, value) }));
  }
}

function metricValue(key: string, value: JsonValue): string {
  if (typeof value !== 'number') return String(value);
  const formatted = value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (key.endsWith('Kg')) return `${formatted} kg`;
  if (key === 'distanceKm') return `${formatted} km`;
  if (key.endsWith('Percent')) return `${formatted}%`;
  return formatted;
}

function jsonRecord(value: JsonValue): Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function humanize(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}
