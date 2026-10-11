import { Component, input } from '@angular/core';
import { metricValue, type ActivityMetricComparison } from '../model/activity-metrics.models';
@Component({
  selector: 'sportos-activity-metric-provenance', standalone: true,
  template: `
    @if (metrics().length) {
      <details><summary>Normalized metric provenance (advanced)</summary>
        @for (metric of metrics(); track metric.key) {
          <h4>{{ metric.label }}</h4>
          @for (candidate of metric.candidates; track $index) {
            <p>{{ candidate.provider }} · {{ value(candidate.value, metric.unit) }} · {{ candidate.sourceKind.replaceAll('_', ' ') }} · {{ candidate.sourceField }} ({{ candidate.sourceUnit || 'unitless' }}) · {{ candidate.origin.replaceAll('_', ' ') }} · {{ candidate.selectedWithinProvider ? 'provider selection' : 'alternative' }} · normalized {{ candidate.projectedAt }} · version {{ candidate.projectionId }}</p>
          } @empty { <p>Canonical source only.</p> }
        }
      </details>
    }
  `,
  styles: [`details{margin-top:16px;font-size:13px;overflow-wrap:anywhere}summary{cursor:pointer;font-weight:700}p{color:#667085}`],
})
export class ActivityMetricProvenanceComponent {
  readonly metrics = input<ActivityMetricComparison[]>([]);
  readonly value = metricValue;
}
