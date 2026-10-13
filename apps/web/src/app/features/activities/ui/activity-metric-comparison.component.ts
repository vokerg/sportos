import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import type { ActivityDetail } from '../activities-api.service';
import type { ActivityMetricComparison } from '../model/activity-metrics.models';
import { comparisonGroups, detailMetricGroups, highlightMetrics } from '../model/activity-metrics.view-model';
@Component({
  selector: 'sportos-activity-metric-comparison', standalone: true, imports: [NgTemplateOutlet],
  template: `
    <ng-template #values let-metric>
      @for (value of metric.values; track $index) {
        <div class="value" [class.authoritative]="metric.values.length > 1 && value.authoritative"
          [class.alternative]="metric.values.length > 1 && !value.authoritative && !value.fallback">
          <strong>{{ value.text }}</strong>
          @if (!(metric.values.length === 1 && value.sources.includes('Strava') && value.sources.includes('Garmin'))) {
            <span class="sources">{{ value.sources.join(' · ') }}</span>
          }
          @if (value.fallback) { <span class="fallback">Read-only fallback</span> }
        </div>
      } @empty { <span class="unavailable">Unavailable</span> }
    </ng-template>
    @if (presentation() !== 'details' && (highlights().length || presentation() === 'summary')) {
      <section class="highlights" [attr.data-sport]="sport()" aria-label="Activity highlights">
        <ng-content select="header" />
        @if (presentation() !== 'summary') { <div class="summary-heading"><h2>{{ summaryTitle() }}</h2><span>At a glance</span></div> }
        <dl class="highlight-grid">@for (metric of highlights(); track metric.key) {
          <div class="highlight"><dt>{{ metric.label }}</dt><dd><ng-container [ngTemplateOutlet]="values" [ngTemplateOutletContext]="{ $implicit: metric }" /></dd></div>
        }</dl>
      </section>
    }
    @if (presentation() !== 'summary' && groups().length) {
      <section class="card" aria-label="Activity metrics"><h2>{{ activity() ? 'More activity metrics' : 'Activity metrics' }}</h2>
        <p>Matching Strava and Garmin values appear once without provider labels (within display tolerance). When values differ, the primary value is bold. Garmin fallbacks are read-only.</p>
        @for (group of groups(); track group.title) {
          <section class="group" [attr.aria-label]="group.title"><h3>{{ group.title }}</h3>
            <dl class="comparison">@for (metric of group.items; track metric.key) {
              <div class="metric"><dt>{{ metric.label }}</dt><dd><ng-container [ngTemplateOutlet]="values" [ngTemplateOutletContext]="{ $implicit: metric }" /></dd></div>
            }</dl>
          </section>
        }
      </section>
    }
  `,
  styles: [`
    :host{display:block;margin-top:16px}h2{font-size:17px;margin-top:0}h3{font-size:14px;color:#344054;margin:0 0 12px}
    p,.unavailable{color:#667085;font-size:13px}.group{border-top:1px solid #eaecf0;padding-top:16px;margin-top:16px}
    .comparison{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));gap:20px;margin:0}
    .metric{min-width:0;overflow-wrap:anywhere}dt{color:#667085;font-size:12px;margin-bottom:6px}dd{margin:0;display:grid;gap:8px}
    .value{display:flex;flex-wrap:wrap;align-items:baseline;gap:5px 8px;font-size:14px}.value strong{font-weight:500}.authoritative strong{font-weight:750}
    .sources{color:#475467;font-size:12px}.fallback{font-size:11px;padding:2px 6px;border-radius:4px;background:#eef2ff;color:#344054}
    .highlights{--accent:#3457bd;--tint:#edf2ff;border:1px solid #d9e1f0;border-radius:20px;padding:24px;margin-bottom:20px;background:linear-gradient(120deg,var(--tint),#fff 85%);box-shadow:0 8px 24px #14213d06}
    .highlights[data-sport=bike]{--accent:#087969;--tint:#e8f6f1}
    .highlights[data-sport=swim]{--accent:#096e9a;--tint:#e8f5fc}
    .summary-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px}
    .summary-heading h2{margin:0;color:var(--accent);font-size:16px}.summary-heading>span{color:#475467;font-size:12px}
    .highlight-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;margin:0}
    .highlight{min-width:0;border-left:3px solid var(--accent);padding-left:18px}
    .highlight dt{font-size:13px;font-weight:600;color:#475467;margin-bottom:10px}
    .highlight .value{display:grid;gap:4px;font-variant-numeric:tabular-nums}
    .highlight strong{font-size:clamp(24px,2.5vw,38px);letter-spacing:-1px;font-weight:750;line-height:1.15;color:#172033}
    .highlight .alternative strong{font-size:20px;font-weight:500;letter-spacing:-.4px;color:#475467}
    .highlight .sources{font-size:12px}.highlight .fallback{justify-self:start}
    @media(max-width:700px){.highlights{padding:18px}.highlight-grid{grid-template-columns:1fr;gap:20px}.highlight{padding-left:14px}.highlight strong{font-size:30px}.summary-heading{margin-bottom:18px}}
  `],
})
export class ActivityMetricComparisonComponent {
  readonly metrics = input<ActivityMetricComparison[]>([]);
  readonly sport = input('');
  readonly presentation = input<'all' | 'summary' | 'details'>('all');
  readonly activity = input<ActivityDetail | null>(null);
  private readonly allGroups = computed(() => {
    const activity = this.activity();
    return activity ? detailMetricGroups(activity, this.metrics()) : comparisonGroups(this.metrics(), this.sport());
  });
  readonly highlights = computed(() => this.activity() ? highlightMetrics(this.allGroups(), this.sport()) : []);
  readonly groups = computed(() => {
    const keys = new Set(this.highlights().map(m => m.key));
    return this.allGroups().map(g => ({ ...g, items: g.items.filter(m => !keys.has(m.key)) })).filter(g => g.items.length);
  });
  readonly summaryTitle = computed(() => ({ run: 'Run summary', swim: 'Swim summary', bike: 'Ride summary', walk: 'Walk summary' } as Record<string, string>)[this.sport()] ?? 'Activity summary');
}
