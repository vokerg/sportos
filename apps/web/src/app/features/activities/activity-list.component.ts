import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Activity } from './activities-api.service';
import { metrics, startTime, title } from './activity.view-model';

@Component({
  selector: 'sportos-activity-list', standalone: true, imports: [RouterLink],
  template: `
    <div class="activity-list">
      @for (activity of activities(); track activity.id) {
        <a class="card activity" [routerLink]="['/activity', activity.id]">
          <div class="heading"><strong>{{ title(activity) }} @if (activity.subtype && activity.subtype !== 'unknown') { <small>· {{ activity.subtype }}</small> }</strong><span>{{ activity.activity_date }} @if (startTime(activity.start_time)) { · {{ startTime(activity.start_time) }} }</span></div>
          <div class="source">{{ activity.source.replaceAll('_', ' ') }}</div>
          <div class="metrics">@for (metric of metrics(activity); track metric.label) { <span><b>{{ metric.value }}</b><small>{{ metric.label }}</small></span> }</div>
        </a>
      }
    </div>
  `,
  styles: [`
    .activity-list { display: grid; gap: 10px; }
    .activity { display: grid; gap: 10px; color: inherit; text-decoration: none; }
    .activity:hover { border-color: #91a9e6; background: #f8faff; }
    .heading { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .heading strong { font-size: 18px; }.heading small { font-size: 13px; color: #667085; font-weight: 500; }
    .heading span,.source { color: #667085; font-size: 13px; }.source { text-transform: capitalize; }
    .metrics { display: flex; flex-wrap: wrap; gap: 10px 24px; }
    .metrics span { display: grid; gap: 2px; }.metrics small { color: #667085; font-size: 11px; }
  `],
})
export class ActivityListComponent {
  readonly activities = input.required<Activity[]>();
  readonly metrics = metrics;
  readonly startTime = startTime;
  readonly title = title;
}
