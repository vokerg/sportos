import { Component, computed, input } from '@angular/core';
import type { ActivityMetricComparison } from '../model/activity-metrics.models';
import { comparisonGroups } from '../model/activity-metrics.view-model';
@Component({
  selector: 'sportos-activity-metric-comparison', standalone: true,
  template: `
    @if (groups().length) {
      <section class="card" aria-label="Activity metrics"><h2>Activity metrics</h2>
        <p>Sources share a value when differences are within display tolerance. When values differ, the primary value is bold. Garmin fallbacks are read-only.</p>
        @for (group of groups(); track group.title) {
          <section class="group" [attr.aria-label]="group.title"><h3>{{ group.title }}</h3>
            <dl class="comparison">@for (metric of group.items; track metric.key) {
              <div class="metric"><dt>{{ metric.label }}</dt><dd>
                @for (value of metric.values; track $index) {
                  <div class="value" [class.authoritative]="metric.values.length > 1 && value.authoritative">
                    <strong>{{ value.text }}</strong><span class="sources">{{ value.sources.join(' · ') }}</span>
                    @if (value.fallback) { <span class="fallback">Read-only fallback</span> }
                  </div>
                } @empty { <span class="unavailable">Unavailable</span> }
              </dd></div>
            }</dl>
          </section>
        }
      </section>
    }
  `,
  styles: [`
    :host{display:block;margin-top:16px}h2{font-size:17px;margin-top:0}h3{font-size:14px;color:#344054;margin:0 0 12px}
    p,.unavailable{color:#667085;font-size:13px}.group{border-top:1px solid #eaecf0;padding-top:16px;margin-top:16px}
    .comparison{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));gap:18px;margin:0}
    .metric{min-width:0;overflow-wrap:anywhere}dt{color:#667085;font-size:12px;margin-bottom:6px}dd{margin:0;display:grid;gap:8px}
    .value{display:flex;flex-wrap:wrap;align-items:baseline;gap:5px 8px;font-size:13px}.value strong{font-weight:500}.authoritative strong{font-weight:750}
    .sources{color:#475467;font-size:12px}.fallback{font-size:11px;padding:2px 6px;border-radius:4px;background:#eef2ff;color:#344054}
  `],
})
export class ActivityMetricComparisonComponent {
  readonly metrics = input<ActivityMetricComparison[]>([]);
  readonly sport = input('');
  readonly groups = computed(() => comparisonGroups(this.metrics(), this.sport()));
}
