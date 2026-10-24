import { ColorSchemeService } from '../../../core/theme/color-scheme.service';
import { inject, Component, computed, input, output, signal } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { timelineOptions, timelineReason, type ActivityTimeline, type TimelineSource } from '../model/activity-timeline.models';
@Component({
  selector:'sportos-activity-timeline', standalone:true, imports:[NgxEchartsDirective],
  template:`
    <section class="card timeline" [class.embedded]="embedded()" aria-labelledby="activity-timeline-title">
      <div class="heading"><div><h2 id="activity-timeline-title">{{ sport() === 'swim' ? (embedded() ? 'Telemetry' : 'Swim telemetry') : 'Activity graph' }}</h2><p>{{ sport() === 'swim' ? 'Swim pace per 100 m, heart rate and recorded metrics over time.' : 'Pace, heart rate, power and recorded metrics over time.' }}</p></div>
        <div class="source-switch" role="group" aria-label="Graph data source">
          @for (provider of sources; track provider) {
            <button type="button" [attr.aria-pressed]="source() === provider" [class.active]="source() === provider" (click)="selectSource(provider)">{{ provider === 'strava' ? 'Strava' : 'Garmin' }}</button>
          }
        </div>
      </div>
      @if (state() === 'idle') {
        <div class="empty"><p>View the retained timeline for this activity.</p><button type="button" (click)="load.emit(source())">Show graph</button></div>
      } @else if (state() === 'loading') { <p class="empty" role="status">Loading {{ source() === 'strava' ? 'Strava' : 'Garmin' }} graph…</p> }
      @else if (state() === 'error') { <p role="alert">Could not load the graph. <button type="button" (click)="load.emit(source())">Try again</button></p> }
      @else { @if (data(); as data) {
        @if (data.status === 'unavailable') { <p class="empty">{{ reason(data.reason) }}</p> }
        @else {
          <div class="metric-switches" role="group" aria-label="Visible graph metrics">
            @for (metric of data.metrics; track metric.key) {
              <button type="button" [attr.aria-pressed]="selected().includes(metric.key)" [class.selected]="selected().includes(metric.key)" (click)="toggle(metric.key)">{{ metric.label }} <small>{{ metric.unit }}</small></button>
            }
          </div>
          @if (visible().length) {
            <div echarts [theme]="colorScheme.chartTheme()" class="chart" [style.height.px]="visible().length * 170 + 65" [options]="options()" [notMerge]="true" role="img" [attr.aria-label]="source() + ' activity metrics by elapsed time. Scroll to zoom; drag the slider to select a time range.'"></div>
          } @else { <p class="empty">Choose a metric to display.</p> }
          <p class="hint">Scroll to zoom · use the slider to explore · hover to inspect. Gaps are left open. @if (data.simplified) { Display simplified from {{ data.sampleCount }} recorded samples; original data is retained. }</p>
          <p class="hint">Only recorded metrics are offered. @if (sport() === 'swim') { {{ embedded() ? 'Length breakdown, stroke counts and SWOLF are shown above alongside per-second telemetry when retained.' : 'Length breakdown, stroke counts and SWOLF are available in Swim stats when retained.' }} } @else { Cadence uses the provider's recorded rpm without conversion to steps/min. } Sources have independent timelines; pace uses recorded speed, not corrected summary distance.</p>
        }
        <button class="reload" type="button" (click)="load.emit(source())">Reload retained graph</button>
      }
      }
      <p class="hint">Retained {{ source() === 'strava' ? 'Strava streams' : 'Garmin FIT' }} only. Fetch or refresh detail below to download missing data.</p>
    </section>`,
  styles:[`:host{display:block;margin:16px 0}.timeline{overflow:hidden}.timeline.embedded{margin:24px 0 0;padding:20px 0 0;border-top:1px solid var(--border);border-radius:0;background:transparent;box-shadow:none}.heading{display:flex;justify-content:space-between;gap:16px;align-items:center;flex-wrap:wrap}h2{margin:0;font-size:19px}.heading p{margin:6px 0 0;color:var(--text-muted);font-size:13px}.source-switch{display:flex;background:var(--surface-muted);padding:4px;border-radius:10px;gap:4px}.source-switch button{border:0;background:transparent;color:var(--text-muted);padding:9px 18px;border-radius:7px;font-weight:600}.source-switch .active{background:var(--surface);color:var(--link);box-shadow:0 1px 4px #10182822}.metric-switches{display:flex;gap:8px;flex-wrap:wrap;margin:20px 0 10px}.metric-switches button{border:1px solid var(--border);border-radius:18px;padding:7px 12px;background:var(--surface);color:var(--text-muted)}.metric-switches .selected{border-color:var(--border-accent);background:var(--accent-surface);color:var(--link)}small{font-size:10px;margin-left:5px}.chart{width:100%;min-width:0}.empty{padding:24px 0;color:var(--text-muted)}.hint{color:var(--text-muted);font-size:12px;line-height:1.6;margin-bottom:0}.reload{margin-top:12px;font-size:12px}`],
})
export class ActivityTimelineComponent {
  readonly colorScheme = inject(ColorSchemeService);
  readonly sources: TimelineSource[] = ['strava','garmin'];
  readonly sport = input<string>('run');
  readonly source = input<TimelineSource>('strava');
  readonly state = input<'idle'|'loading'|'loaded'|'error'>('idle');
  readonly data = input<ActivityTimeline|null>(null);
  readonly embedded = input(false);
  readonly load = output<TimelineSource>();
  readonly chosen = signal<string[]|null>(null);
  readonly selected = computed(() => {
    if (this.chosen()) return this.chosen()!;
    const keys = this.data()?.metrics.map(m=>m.key) ?? [];
    const defaults = keys.filter(k=> (this.sport() === 'swim' ? ['pace','heartRate','distance'] : ['pace','heartRate','power']).includes(k));
    return defaults.length ? defaults : keys.slice(0,3);
  });
  readonly visible = computed(() => this.data()?.metrics.filter(m=>this.selected().includes(m.key)) ?? []);
  readonly options = computed(() => this.data() ? timelineOptions(this.data()!,this.visible()) : {});
  readonly reason = timelineReason;
  selectSource(source: TimelineSource) { if (source !== this.source() || this.state() === 'idle') { this.chosen.set(null); this.load.emit(source); } }
  toggle(key:string) { this.chosen.set(this.selected().includes(key) ? this.selected().filter(k=>k!==key) : [...this.selected(),key]); }
}
