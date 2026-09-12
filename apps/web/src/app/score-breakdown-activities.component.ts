import { Component, input } from '@angular/core';
import type { DailyScoreBreakdown } from './score-breakdown.models';
import {
  activityName,
  activityScoreLabel,
  formatDistance,
  formatDuration,
  formatActivityRate,
  formatScoreDate,
  formatTimestamp,
  sourceName,
  sourceSummary,
} from './score-breakdown.view-model';

@Component({
  selector: 'sportos-score-breakdown-activities',
  standalone: true,
  template: `
    @let current = breakdown();
    <section class="data-section" aria-labelledby="day-activities-title">
      <div class="section-heading">
        <div>
          <span class="section-label">All canonical activities</span>
          <h4 id="day-activities-title">Activities recorded for {{ formatScoreDate(current.date) }}</h4>
          <p class="section-help">Imported rows use the saved workbook ledger. Recalculated rows use the canonical activities shown here, including Strava records.</p>
        </div>
        <strong class="count-badge">{{ current.activities.length }}</strong>
      </div>
      @if (current.activities.length === 0) {
        <div class="empty-inline">No canonical activities were recorded for this date.</div>
      } @else {
        <div class="table-scroll">
          <table class="activity-table">
            <thead>
              <tr><th>Source</th><th>Activity</th><th>Distance</th><th>Elapsed</th><th>Moving</th><th>Pace / speed</th><th>Score link</th><th>Provenance</th></tr>
            </thead>
            <tbody>
              @for (activity of current.activities; track activity.id) {
                <tr>
                  <td><span class="source-badge" [attr.data-source]="activity.source">{{ sourceName(activity.source) }}</span></td>
                  <td><strong>{{ activityName(activity) }}</strong><small>{{ formatTimestamp(activity.startTime, 'No start time') }}</small></td>
                  <td>{{ activity.distanceM === null ? '—' : formatDistance(activity.distanceM) }}</td>
                  <td>{{ activity.durationS === null ? '—' : formatDuration(activity.durationS) }}</td>
                  <td>{{ activity.movingTimeS === null ? '—' : formatDuration(activity.movingTimeS) }}</td>
                  <td>{{ formatActivityRate(activity) }}</td>
                  <td><span class="score-link" [class.context-only]="activityScoreLabel(activity, current) === 'Context only'" [class.daily-fact]="activityScoreLabel(activity, current) === 'Daily fact'">{{ activityScoreLabel(activity, current) }}</span></td>
                  <td>{{ sourceSummary(activity.sourceRecord) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
  styles: [`
    .data-section { margin: 22px 0; }
    .section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
    .section-heading h4 { margin: 3px 0 0; color: #172b4d; font-size: 17px; }
    .section-label { color: #667085; font-size: 11px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
    .section-help { max-width: 760px; margin: 5px 0 0; color: #667085; font-size: 12px; line-height: 1.45; }
    .count-badge { flex: 0 0 auto; padding: 5px 9px; border-radius: 999px; background: #eef3ff; color: #40558f; font-size: 12px; }
    .empty-inline { padding: 14px; border: 1px dashed #c7d2e5; border-radius: 10px; color: #667085; background: #fff; }
    .table-scroll { overflow-x: auto; border: 1px solid #e1e7f0; border-radius: 10px; background: #fff; }
    .activity-table { width: 100%; min-width: 980px; border-collapse: collapse; font-size: 12px; }
    .activity-table th, .activity-table td { padding: 10px 11px; border-bottom: 1px solid #edf0f5; text-align: left; vertical-align: top; }
    .activity-table th { color: #667085; background: #f8fafc; font-size: 10px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; white-space: nowrap; }
    .activity-table tbody tr:last-child td { border-bottom: 0; }
    .activity-table td strong { display: block; color: #243b73; }
    .activity-table td small { display: block; margin-top: 3px; color: #667085; }
    .source-badge, .score-link { display: inline-block; padding: 4px 7px; border-radius: 999px; background: #eef3ff; color: #40558f; font-size: 10px; font-weight: 800; white-space: nowrap; }
    .source-badge[data-source='strava'] { background: #fff0e8; color: #b54708; }
    .source-badge[data-source='my_sport_xlsx'] { background: #eaf7ee; color: #13795b; }
    .score-link.daily-fact { background: #eaf7ee; color: #13795b; }
    .score-link.context-only { background: #f2f4f7; color: #667085; }
    @media (max-width: 680px) { .section-heading { flex-direction: column; } }
  `],
})
export class ScoreBreakdownActivitiesComponent {
  readonly breakdown = input.required<DailyScoreBreakdown>();

  readonly activityName = activityName;
  readonly activityScoreLabel = activityScoreLabel;
  readonly formatDistance = formatDistance;
  readonly formatDuration = formatDuration;
  readonly formatActivityRate = formatActivityRate;
  readonly formatScoreDate = formatScoreDate;
  readonly formatTimestamp = formatTimestamp;
  readonly sourceName = sourceName;
  readonly sourceSummary = sourceSummary;
}
