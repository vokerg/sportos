import { ProviderMetricStatusComponent } from './ui/provider-metric-status.component';
import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Activity } from './activities-api.service';
import { listMetricHighlights, listSecondaryMetrics, startTime, subtypeLabel, title } from './activity.view-model';

@Component({
  selector: 'sportos-activity-list', standalone: true, imports: [RouterLink, ProviderMetricStatusComponent],
  template: `
    <div class="activity-list">
      @for (activity of activities(); track activity.id) {
        <a class="card activity" [attr.data-sport]="activity.activity_type" [routerLink]="['/activity', activity.id]">
          <div class="heading"><strong>{{ title(activity) }} @if (activity.subtype && activity.subtype !== 'unknown') { <small>· {{ subtypeLabel(activity.subtype) }}</small> }</strong><span>{{ activity.activity_date }} @if (startTime(activity.start_time)) { · {{ startTime(activity.start_time) }} }</span></div>
          <div class="source">{{ activity.source.replaceAll('_', ' ') }}</div>
          @if (activity.source === 'strava' && activity.notes) { <div class="description">{{ activity.notes }}</div> }
          <sportos-provider-metric-status [statuses]="activity.providerMetrics ?? []" />
          <div class="metrics highlights">@for (metric of listMetricHighlights(activity); track metric.label) { <span><b>{{ metric.value }}</b><small>{{ metric.label }}</small></span> }</div>
          <div class="metrics secondary">@for (metric of listSecondaryMetrics(activity); track metric.label) { <span><b>{{ metric.value }}</b><small>{{ metric.label }}</small></span> }</div>
        </a>
      }
    </div>
  `,
  styles: [`
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
  readonly listMetricHighlights = listMetricHighlights;
  readonly listSecondaryMetrics = listSecondaryMetrics;
  readonly startTime = startTime;
  readonly title = title;
  readonly subtypeLabel = subtypeLabel;
}
