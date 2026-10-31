import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ActivityTypeIconComponent } from '../../../shared/ui/activity-type-icon.component';
import { ProviderMetricStatusComponent } from './provider-metric-status.component';
import type { Activity } from '../activities-api.service';
import { title, displayedSubtype, startTime, listMetricHighlights, listSecondaryMetrics } from '../activity.view-model';

/** Shared Activities presentation: inputs only; no fetching or provider actions. */
@Component({
  selector: 'sportos-activity-card', standalone: true,
  imports: [RouterLink, ActivityTypeIconComponent, ProviderMetricStatusComponent],
  template: `
        <a class="card activity" [attr.data-sport]="activity().activity_type" [routerLink]="['/activity', activity().id]">
          <div class="heading"><div class="activity-heading"><sportos-activity-type-icon [activityType]="activity().activity_type" [attr.data-sport]="activity().activity_type" /><strong>{{ title(activity()) }} @if (activity().historicalSummary) { <span class="muted">· Historical Excel summary</span> } @if (displayedSubtype(activity())) { <small [attr.title]="activity().runClassification ? 'Run type from Garmin' : null">· {{ displayedSubtype(activity()) }}</small> } @if (activity().distanceCorrection) { <span class="correction-badge">Manual correction</span> }</strong></div><span>{{ activity().activity_date }} @if (startTime(activity().start_time)) { · {{ startTime(activity().start_time) }} }</span></div>
          @if (activity().source === 'strava' && activity().notes) { <div class="description">{{ activity().notes }}</div> }
          <sportos-provider-metric-status [statuses]="activity().providerMetrics ?? []" />
          <div class="metrics highlights">@for (metric of listMetricHighlights(activity()); track metric.label) { <span><b>{{ metric.value }}</b><small>{{ metric.label }}</small></span> }</div>
          <div class="metrics secondary">@for (metric of listSecondaryMetrics(activity()); track metric.label) { <span><b>{{ metric.value }}</b><small>{{ metric.label }}</small></span> }</div>
        </a>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .muted { color: var(--text-muted); font-weight: 400; }
    .correction-badge { padding: 2px 7px; border-radius: 10px; background: var(--accent-surface); color: var(--text-secondary); font-size: 11px; }
    sportos-activity-type-icon[data-sport=bike] { --activity-icon-color: var(--sport-bike); } sportos-activity-type-icon[data-sport=swim] { --activity-icon-color: var(--sport-swim); }
    .activity { --accent: var(--sport-run); border-left: 4px solid var(--accent); display: grid; gap: 10px; color: inherit; text-decoration: none; }
    .activity[data-sport=bike] { --accent: var(--sport-bike); }.activity[data-sport=swim] { --accent: var(--sport-swim); }
    .activity:hover { border-color: var(--border-accent); background: var(--accent-surface); }
    .heading { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }.activity-heading { display: flex; align-items: center; gap: 9px; min-width: 0; }.activity-heading strong { display: block; }
    .heading strong { font-size: 18px; }.heading small { font-size: 13px; color: var(--text-muted); font-weight: 500; }
    .heading span { color: var(--text-muted); font-size: 13px; }
    .description { color: var(--text-secondary); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .metrics { display: flex; flex-wrap: wrap; gap: 10px 24px; }
    .highlights { padding: 12px 0 4px; gap: 12px 32px; }.highlights b { font-size: 24px; color: var(--accent); font-variant-numeric: tabular-nums; }.secondary b { font-size: 13px; font-weight: 500; }.secondary:empty { display: none; }
    .metrics span { display: grid; gap: 2px; }.metrics small { color: var(--text-muted); font-size: 11px; }
  `],
})
export class ActivityCardComponent {
  readonly activity = input.required<Activity>();
  readonly title = title;
  readonly displayedSubtype = displayedSubtype;
  readonly startTime = startTime;
  readonly listMetricHighlights = listMetricHighlights;
  readonly listSecondaryMetrics = listSecondaryMetrics;
}
