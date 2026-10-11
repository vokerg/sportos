import { ProviderMetricStatusComponent } from './ui/provider-metric-status.component';
import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Activity } from './activities-api.service';
import { compactActivityMetrics, listMetricHighlights, listSecondaryMetrics, startTime, title, displayedSubtype } from './activity.view-model';

@Component({
  selector: 'sportos-activity-list', standalone: true, imports: [RouterLink, ProviderMetricStatusComponent],
  template: `
    @if (compact()) {
      <div class="table-scroll" tabindex="0" role="region" aria-label="Compact activity list">
        <table><caption class="visually-hidden">Activities — one row per activity</caption>
          <thead><tr><th scope="col">Date</th><th scope="col">Activity</th><th scope="col">Distance</th><th scope="col">Pace / speed</th><th scope="col">Time</th><th scope="col">Avg HR</th><th scope="col">Ascent</th><th scope="col">Source</th><th scope="col">Providers</th></tr></thead>
          <tbody>@for (activity of activities(); track activity.id) {
            @let values = compactActivityMetrics(activity);
            <tr [attr.data-sport]="activity.activity_type">
              <td>{{ activity.activity_date }} @if (startTime(activity.start_time); as time) { <span class="muted">{{ time }}</span> }</td>
              <th scope="row"><a [routerLink]="['/activity', activity.id]">{{ title(activity) }} @if (displayedSubtype(activity)) { <span class="muted" [attr.title]="activity.runClassification ? 'Run type from Garmin' : null">· {{ displayedSubtype(activity) }}</span> } @if (activity.source === 'strava' && activity.notes) { <span class="row-name" [title]="activity.notes">{{ activity.notes }}</span> }</a></th>
              <td class="number">{{ values.distance }}</td><td class="number">{{ values.paceOrSpeed }}</td>
              <td class="number" [title]="values.time?.label ?? 'Time unavailable'" [attr.aria-label]="values.time ? values.time.label + ': ' + values.time.value : 'Time unavailable'">{{ values.time?.value ?? '—' }}</td>
              <td class="number">{{ values.heartRate }}</td><td class="number">{{ values.elevation }}</td>
              <td class="source">{{ activity.source.replaceAll('_', ' ') }}</td>
              <td><sportos-provider-metric-status [statuses]="activity.providerMetrics ?? []" /></td>
            </tr>
          }</tbody>
        </table>
      </div>
    } @else {
    <div class="activity-list">
      @for (activity of activities(); track activity.id) {
        <a class="card activity" [attr.data-sport]="activity.activity_type" [routerLink]="['/activity', activity.id]">
          <div class="heading"><strong>{{ title(activity) }} @if (displayedSubtype(activity)) { <small [attr.title]="activity.runClassification ? 'Run type from Garmin' : null">· {{ displayedSubtype(activity) }}</small> }</strong><span>{{ activity.activity_date }} @if (startTime(activity.start_time)) { · {{ startTime(activity.start_time) }} }</span></div>
          <div class="source">{{ activity.source.replaceAll('_', ' ') }}</div>
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
    .table-scroll { overflow-x: auto; border: 1px solid #e4e7ec; border-radius: 12px; background: white; }
    .table-scroll:focus-visible { outline: 3px solid #f59e0b; outline-offset: 2px; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; white-space: nowrap; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #eaecf0; }
    thead th { background: #f8fafc; color: #475467; font-size: 11px; font-weight: 650; }
    tbody th { font-weight: 600; } tbody tr:last-child :is(th, td) { border-bottom: 0; }
    tbody tr:hover { background: #f8faff; } tbody a { display: flex; align-items: center; gap: 6px; color: #3457bd; text-decoration: none; }
    tr[data-sport=bike] a { color: #087969; } tr[data-sport=swim] a { color: #096e9a; }
    .muted, .row-name { color: #667085; font-weight: 400; }.muted { margin-left: 4px; }
    .row-name { display: inline-block; max-width: 170px; overflow: hidden; text-overflow: ellipsis; }
    .number { font-variant-numeric: tabular-nums; }
    .activity-list { display: grid; gap: 10px; }
    .activity { --accent: #3457bd; border-left: 4px solid var(--accent); display: grid; gap: 10px; color: inherit; text-decoration: none; }
    .activity[data-sport=bike] { --accent: #087969; }.activity[data-sport=swim] { --accent: #096e9a; }
    .activity:hover { border-color: #91a9e6; background: #f8faff; }
    .heading { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .heading strong { font-size: 18px; }.heading small { font-size: 13px; color: #667085; font-weight: 500; }
    .heading span,.source { color: #667085; font-size: 13px; }.source { text-transform: capitalize; }
    .description { color: #344054; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .metrics { display: flex; flex-wrap: wrap; gap: 10px 24px; }
    .highlights { padding: 12px 0 4px; gap: 12px 32px; }.highlights b { font-size: 24px; color: var(--accent); font-variant-numeric: tabular-nums; }.secondary b { font-size: 13px; font-weight: 500; }.secondary:empty { display: none; }
    .metrics span { display: grid; gap: 2px; }.metrics small { color: #667085; font-size: 11px; }
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
