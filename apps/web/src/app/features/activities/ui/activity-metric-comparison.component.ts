import { Component, input } from '@angular/core';
import { metricValue, type ActivityMetricComparison } from '../model/activity-metrics.models';
@Component({selector:'sportos-activity-metric-comparison',standalone:true,template:`
  @if (metrics().length) {
    <section class="card" aria-label="Provider metric comparison"><h2>Activity metrics by source</h2>
      <p>Selected values follow canonical source authority and the metric catalog. Missing observations remain unavailable.</p>
      <div class="comparison">@for (metric of metrics();track metric.key) {
        <div class="metric"><strong>{{ metric.label }}</strong>
          <span>Selected: {{ metric.selected ? value(metric.selected.value,metric.unit) + ' · ' + metric.selected.source : 'Unavailable' }}</span>
          <span class="candidates">@for (candidate of metric.candidates;track $index) {
            @if (candidate.selectedWithinProvider) { <span>{{ candidate.provider === 'strava' ? 'Strava' : 'Garmin' }} {{ value(candidate.value,metric.unit) }}</span> }
          }</span>
          @if (metric.candidates.length) {
            <details><summary>Metric provenance</summary>@for(candidate of metric.candidates;track $index) {
              <p>{{ candidate.provider }} · {{ value(candidate.value,metric.unit) }} · {{ candidate.sourceKind.replaceAll('_',' ') }} · {{ candidate.sourceField }} ({{ candidate.sourceUnit || 'unitless' }}) · {{ candidate.origin.replaceAll('_',' ') }} · {{ candidate.selectedWithinProvider ? 'provider selection' : 'alternative' }} · normalized {{ candidate.projectedAt }} · version {{ candidate.projectionId }}</p>
            }</details>
          }
        </div>
      }</div>
    </section>
  }`,styles:[`:host{display:block;margin-top:16px}h2{font-size:17px;margin-top:0}p{color:#667085;font-size:13px}.comparison{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:16px}.metric{display:grid;align-content:start;gap:6px;font-size:13px;overflow-wrap:anywhere}.candidates{display:flex;flex-wrap:wrap;gap:8px;color:#344054}details{color:#667085}summary{cursor:pointer}`]})
export class ActivityMetricComparisonComponent {readonly metrics=input<ActivityMetricComparison[]>([]);readonly value=metricValue;}
