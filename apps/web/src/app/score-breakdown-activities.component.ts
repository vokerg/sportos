import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { DailyScoreBreakdown } from './score-breakdown.models';
import { formatSwimMeters } from './swim-distance';
import {
  activityName,
  formatDistance,
  formatDuration,
  formatActivityRate,
  formatScoreDate,
  formatTimestamp,
  sourceName,
} from './score-breakdown.view-model';

@Component({
  selector: 'sportos-score-breakdown-activities',
  standalone: true,
  imports: [RouterLink],
  template: `
    @let current = breakdown();
    <section class="data-section" aria-labelledby="day-activities-title">
      <div class="section-heading">
        <div>
          <span class="section-label">Training</span>
          <h4 id="day-activities-title">Activities</h4>
          <p class="section-help">Daily totals are shown above. Garmin links enrich the same activity.</p>
        </div>
        <strong class="count-badge">{{ activities().length }}</strong>
      </div>
      @if (activities().length === 0) {
        <div class="empty-inline">No canonical activities were recorded for this date.</div>
      } @else {
        <div class="table-scroll">
          <table class="activity-table">
            <thead>
              <tr><th>Source</th><th>Activity</th><th>Distance</th><th>Duration</th><th>Pace / speed</th></tr>
            </thead>
            <tbody>
              @for (activity of activities(); track activity.id) {
                <tr>
                  <td><span class="source-badge" [attr.data-source]="activity.source">{{ sourceName(activity.source) }}</span> @if (garminActivityIds().includes(activity.id)) { <span class="source-badge" data-source="garmin">Garmin</span> }</td>
                  <td><a [routerLink]="['/activity', activity.id]"><strong>{{ activityName(activity) }}</strong></a><small>{{ activity.startTime ? formatTimestamp(activity.startTime).split(', ').slice(1).join(', ') : '' }}</small></td>
                  <td>{{ activity.distanceM === null || activity.distanceM === 0 ? '—' : activity.activityType === 'swim' ? formatSwimMeters(activity.distanceM) : formatDistance(activity.distanceM) }}</td>
                  <td>{{ activity.durationS === null ? '—' : formatDuration(activity.durationS) }}</td>
                  <td>{{ activity.activityType === 'workout' ? '—' : formatActivityRate(activity) }}</td>

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
    .activity-table { width: 100%; min-width: 560px; border-collapse: collapse; font-size: 12px; }
    .activity-table th, .activity-table td { padding: 10px 11px; border-bottom: 1px solid #edf0f5; text-align: left; vertical-align: top; }
    .activity-table th { color: #667085; background: #f8fafc; font-size: 10px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; white-space: nowrap; }
    .activity-table tbody tr:last-child td { border-bottom: 0; }
    .activity-table td strong { display: block; color: #243b73; }
    .activity-table td a { color: #243b73; text-decoration: underline; text-underline-offset: 3px; }
    .activity-table td a:hover { color: #1d4ed8; }
    .activity-table td a:focus-visible { outline: 2px solid #1d4ed8; outline-offset: 3px; border-radius: 2px; }
    .activity-table td small { display: block; margin-top: 3px; color: #667085; }
    .source-badge, .score-link { display: inline-block; padding: 4px 7px; border-radius: 999px; background: #eef3ff; color: #40558f; font-size: 10px; font-weight: 800; white-space: nowrap; }
    .source-badge[data-source='garmin'] { background: #e8f4ff; color: #1769aa; }
    .source-badge[data-source='strava'] { background: #fff0e8; color: #b54708; }
    .source-badge[data-source='my_sport_xlsx'] { background: #eaf7ee; color: #13795b; }
    .score-link.daily-fact { background: #eaf7ee; color: #13795b; }
    .score-link.context-only { background: #f2f4f7; color: #667085; }
    @media (max-width: 680px) { .section-heading { flex-direction: column; } }
  `],
})
export class ScoreBreakdownActivitiesComponent {
  readonly breakdown = input.required<DailyScoreBreakdown>();
  readonly garminActivityIds = input<string[]>([]);
  readonly activities = computed(() => this.breakdown().activities.filter(activity => activity.source !== 'manual' && activity.activityType !== 'steps' && activity.activityType !== 'bonus'));

  readonly activityName = activityName;
  readonly formatDistance = formatDistance;
  readonly formatSwimMeters = formatSwimMeters;
  readonly formatDuration = formatDuration;
  readonly formatActivityRate = formatActivityRate;
  readonly formatScoreDate = formatScoreDate;
  readonly formatTimestamp = formatTimestamp;
  readonly sourceName = sourceName;
}
