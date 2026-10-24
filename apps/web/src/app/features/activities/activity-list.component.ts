import { ProviderMetricStatusComponent } from './ui/provider-metric-status.component';
import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ActivityTypeIconComponent } from '../../shared/ui/activity-type-icon.component';
import type { Activity } from './activities-api.service';
import { compactActivityMetrics, listMetricHighlights, listSecondaryMetrics, startTime, title, displayedSubtype } from './activity.view-model';

@Component({
  selector: 'sportos-activity-list', standalone: true, imports: [RouterLink, ProviderMetricStatusComponent, ActivityTypeIconComponent],
  template: `
    @if (activities().length) { <p class="provider-key" aria-label="Provider icon key">Provider icons: <b>S</b> summary · <b>✓</b> detail · <b>?</b> not checked · <b>!</b> needs attention</p> }
    @if (compact()) {
      <div class="table-scroll" tabindex="0" role="region" aria-label="Compact activity list">
        <table><caption class="visually-hidden">Activities — one row per activity</caption>
          <thead><tr><th scope="col">Date</th><th scope="col">Activity</th><th scope="col">Distance</th><th scope="col">Pace / speed</th><th scope="col">Time</th><th scope="col">Avg HR</th><th scope="col">Ascent</th><th scope="col">Providers</th></tr></thead>
          <tbody>@for (activity of activities(); track activity.id) {
            @let values = compactActivityMetrics(activity);
            <tr [attr.data-sport]="activity.activity_type">
              <td>{{ activity.activity_date }} @if (startTime(activity.start_time); as time) { <span class="muted">{{ time }}</span> }</td>
              <th scope="row"><a [routerLink]="['/activity', activity.id]"><sportos-activity-type-icon [activityType]="activity.activity_type" [attr.data-sport]="activity.activity_type" /><span>{{ title(activity) }} @if (activity.historicalSummary) { <span class="muted">· Historical Excel summary</span> } @if (displayedSubtype(activity)) { <span class="muted" [attr.title]="activity.runClassification ? 'Run type from Garmin' : null">· {{ displayedSubtype(activity) }}</span> } @if (activity.distanceCorrection) { <span class="correction-badge">Manual correction</span> } @if (activity.source === 'strava' && activity.notes) { <span class="row-name" [title]="activity.notes">· {{ activity.notes }}</span> }</span></a></th>
              <td class="number">{{ values.distance }}</td><td class="number">{{ values.paceOrSpeed }}</td>
              <td class="number" [title]="values.time?.label ?? 'Time unavailable'" [attr.aria-label]="values.time ? values.time.label + ': ' + values.time.value : 'Time unavailable'">{{ values.time?.value ?? '—' }}</td>
              <td class="number">{{ values.heartRate }}</td><td class="number">{{ values.elevation }}</td>
              <td><sportos-provider-metric-status [statuses]="activity.providerMetrics ?? []" /></td>
            </tr>
          }</tbody>
        </table>
      </div>
    } @else {
    <div class="activity-list">
      @for (activity of activities(); track activity.id) {
        <a class="card activity" [attr.data-sport]="activity.activity_type" [routerLink]="['/activity', activity.id]">
          <div class="heading"><div class="activity-heading"><sportos-activity-type-icon [activityType]="activity.activity_type" [attr.data-sport]="activity.activity_type" /><strong>{{ title(activity) }} @if (activity.historicalSummary) { <span class="muted">· Historical Excel summary</span> } @if (displayedSubtype(activity)) { <small [attr.title]="activity.runClassification ? 'Run type from Garmin' : null">· {{ displayedSubtype(activity) }}</small> } @if (activity.distanceCorrection) { <span class="correction-badge">Manual correction</span> }</strong></div><span>{{ activity.activity_date }} @if (startTime(activity.start_time)) { · {{ startTime(activity.start_time) }} }</span></div>
          @if (activity.source === 'strava' && activity.notes) { <div class="description">{{ activity.notes }}</div> }
          <sportos-provider-metric-status [statuses]="activity.providerMetrics ?? []" />
          <div class="metrics highlights">@for (metric of listMetricHighlights(activity); track metric.label) { <span><b>{{ metric.value }}</b><small>{{ metric.label }}</small></span> }</div>
          <div class="metrics secondary">@for (metric of listSecondaryMetrics(activity); track metric.label) { <span><b>{{ metric.value }}</b><small>{{ metric.label }}</small></span> }</div>
        </a>
      }
    </div>
    }
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .table-scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
    .table-scroll:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; white-space: nowrap; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); }
    thead th { background: var(--accent-surface); color: var(--text-secondary); font-size: 11px; font-weight: 650; }
    tbody th { font-weight: 600; } tbody tr:last-child :is(th, td) { border-bottom: 0; }
    tbody tr:hover { background: var(--accent-surface); } tbody a { display: flex; align-items: center; gap: 8px; color: var(--sport-run); text-decoration: none; }
    tr[data-sport=bike] a { color: var(--sport-bike); } tr[data-sport=swim] a { color: var(--sport-swim); }
    sportos-activity-type-icon[data-sport=bike] { --activity-icon-color: var(--sport-bike); } sportos-activity-type-icon[data-sport=swim] { --activity-icon-color: var(--sport-swim); }
    .muted, .row-name { color: var(--text-muted); font-weight: 400; }.muted { margin-left: 4px; }.correction-badge { display: inline-block; margin-left: 6px; padding: 2px 7px; border-radius: 10px; background: var(--accent-surface); color: var(--text-secondary); font-size: 11px; font-weight: 650; white-space: nowrap; }
    .row-name { display: inline-block; max-width: 170px; overflow: hidden; text-overflow: ellipsis; }
    .number { font-variant-numeric: tabular-nums; }
    .activity-list { display: grid; gap: 10px; }
    .activity { --accent: var(--sport-run); border-left: 4px solid var(--accent); display: grid; gap: 10px; color: inherit; text-decoration: none; }
    .activity[data-sport=bike] { --accent: var(--sport-bike); }.activity[data-sport=swim] { --accent: var(--sport-swim); }
    .activity:hover { border-color: var(--border-accent); background: var(--accent-surface); }
    .heading { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }.activity-heading { display: flex; align-items: center; gap: 9px; min-width: 0; }.activity-heading strong { display: block; }
    .heading strong { font-size: 18px; }.heading small { font-size: 13px; color: var(--text-muted); font-weight: 500; }
    .heading span { color: var(--text-muted); font-size: 13px; }.provider-key{margin:0 0 10px;color:var(--text-muted);font-size:11px}.provider-key b{color:var(--text-secondary)}
    .description { color: var(--text-secondary); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .metrics { display: flex; flex-wrap: wrap; gap: 10px 24px; }
    .highlights { padding: 12px 0 4px; gap: 12px 32px; }.highlights b { font-size: 24px; color: var(--accent); font-variant-numeric: tabular-nums; }.secondary b { font-size: 13px; font-weight: 500; }.secondary:empty { display: none; }
    .metrics span { display: grid; gap: 2px; }.metrics small { color: var(--text-muted); font-size: 11px; }
  `],
})
export class ActivityListComponent {
  readonly activities = input.required<Activity[]>();
  readonly compact = input(false);
  readonly compactActivityMetrics = compactActivityMetrics;
  readonly listMetricHighlights = listMetricHighlights;
  readonly listSecondaryMetrics = listSecondaryMetrics;
  readonly startTime = startTime;
  readonly title = title;

  readonly displayedSubtype = displayedSubtype;
}
