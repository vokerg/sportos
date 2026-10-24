import { Component, computed, inject, input, output } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { ColorSchemeService } from '../../../core/theme/color-scheme.service';
import { swimLengthChartOptions, swimLengthChartHeight, swimSplitTime } from '../model/swim-length-chart.models';
import type { ActivityTimeline, TimelineSource } from '../model/activity-timeline.models';
import { ActivityTimelineComponent } from './activity-timeline.component';
import { formatDurationClock } from '../../../shared/util/duration';
import type { SwimLengthResponse } from '../activities-api.service';

@Component({
  selector: 'sportos-swim-lengths', standalone: true, imports: [NgxEchartsDirective, ActivityTimelineComponent],
  template: `
    <section class="card swim-stats" aria-labelledby="swim-stats-title">
      <div class="heading">
        <div><h2 id="swim-stats-title">Swim stats</h2>
          <p>Recorded splits, strokes, SWOLF and retained telemetry from the linked Garmin FIT recording.</p></div>
        <button type="button" [disabled]="state() === 'loading'" (click)="load.emit()">
          {{ state() === 'idle' ? 'Load stats' : state() === 'loading' ? 'Loading…' : 'Reload stats' }}
        </button>
      </div>
      @if (state() === 'error') { <p role="alert">Could not read retained swim stats. Try again.</p> }
      @else if (state() === 'loading') { <p role="status">Reading retained Garmin lengths…</p> }
      @else if (state() === 'loaded') { @if (data(); as data) {
        @if (data.status === 'unavailable') {
          <p class="muted">{{ reason(data.reason) }}</p>
        } @else {
          <p class="muted">Pool size: <strong>{{ data.poolLengthDisplay ?? 'Unknown' }}</strong>
            · {{ data.lengths.length }} recorded length/rest messages
            @if (data.expectedActiveLengths !== null) { · {{ data.expectedActiveLengths }} active lengths reported by Garmin }
            @if (data.effectiveActiveLengths !== null && data.effectiveActiveLengths !== undefined && data.expectedActiveLengths !== null && data.effectiveActiveLengths !== data.expectedActiveLengths) {
              · {{ data.effectiveActiveLengths }} effective length equivalent at the corrected distance
            }
          </p>
          @if (data.complete === false || data.truncated) {
            <p role="alert">The retained FIT length messages are incomplete or disagree with Garmin's count. Missing lengths are not estimated.</p>
          }
          @if (data.complete === null) {
            <p class="muted">Garmin did not report length counts, so completeness cannot be verified.</p>
          }
          @if (!hasRest()) {
            <p class="muted">No rest length messages are present in this view. Pauses outside length messages are not reconstructed as rests.</p>
          }
          @if (data.poolLengthM === null) {
            <p class="muted">Pool length could not be verified. Split durations are shown, but per-100 m pace is unavailable.</p>
          }
          @if (chart(); as options) {
            <div echarts [theme]="colorScheme.chartTheme()" class="chart" [style.height.px]="chartHeight()" [options]="options" [notMerge]="true"
              role="img" aria-label="Swimming pace per 100 metres, SWOLF and stroke count by active pool length"></div>
          }
          <div class="table-scroll">
            <table>
              <thead><tr><th scope="col">#</th><th scope="col">Type</th><th scope="col">Distance</th><th scope="col">Split</th><th scope="col">Pace /100 m</th><th scope="col">Strokes</th><th scope="col">SWOLF</th><th scope="col">Stroke</th></tr></thead>
              <tbody>
                @for (length of data.lengths; track length.row) {
                  <tr [class.rest]="length.kind === 'rest'">
                    <td>{{ length.lengthNumber ?? '—' }}</td>
                    <td>{{ length.kind === 'active' ? 'Length' : length.kind === 'rest' ? 'Rest' : 'Unclassified' }}</td>
                    <td>{{ length.kind === 'active' ? data.poolLengthDisplay ?? '—' : '—' }}</td>
                    <td>{{ splitTime(length.durationS) }} @if (length.durationBasis === 'elapsed') { <small title="Timer time missing; elapsed time is shown">elapsed</small> }</td>
                    <td>{{ duration(length.paceSPer100M) }}</td>
                    <td>{{ length.strokes ?? '—' }}</td>
                    <td>{{ length.swolf === null ? '—' : round(length.swolf) }}</td>
                    <td>{{ length.stroke ?? '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p class="muted note">Pace uses the recorded split time and pool size. SWOLF is calculated as active timer seconds + recorded strokes; it is not a separate device observation. An unknown or resting length is not counted as distance. These values do not override activity totals or scoring.</p>
        }
      } } @else { <p class="muted">Load the length-by-length breakdown when Garmin rich data is retained.</p> }
      <p class="muted note">If missing, use Fetch Garmin detail under Provider data below, then reload lengths.</p>
      <sportos-activity-timeline
        [sport]="'swim'"
        [source]="timelineSource()"
        [state]="timelineState()"
        [data]="timelineData()"
        [embedded]="true"
        (load)="timelineLoad.emit($event)"
      />
    </section>
  `,
  styles: [`
    :host{display:block;margin:16px 0}.swim-stats{overflow:hidden}.heading{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}.heading h2{margin:0;font-size:19px}.heading p{margin:6px 0;color:var(--text-muted);font-size:13px}.muted{color:var(--text-muted)}.note{font-size:12px;line-height:1.6}.chart{width:100%;min-width:0;margin:16px 0}.table-scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left;font-variant-numeric:tabular-nums}th,td{padding:10px 12px;border-bottom:1px solid var(--border);white-space:nowrap}th{font-size:12px;color:var(--text-muted)}.rest{color:var(--text-muted)}small{font-size:10px;color:var(--text-muted)}
  `]
})
export class SwimLengthsComponent {
  readonly colorScheme = inject(ColorSchemeService);
  readonly chart = computed(() => this.data()?.status === 'available' ? swimLengthChartOptions(this.data()!) : null);
  readonly chartHeight = computed(() => this.data()?.status === 'available' ? swimLengthChartHeight(this.data()!) : 0);
  readonly state = input<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  readonly data = input<SwimLengthResponse | null>(null);
  readonly timelineState = input<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  readonly timelineSource = input<TimelineSource>('garmin');
  readonly timelineData = input<ActivityTimeline | null>(null);
  readonly load = output<void>();
  readonly timelineLoad = output<TimelineSource>();
  readonly hasRest = computed(() => this.data()?.lengths.some(row => row.kind === 'rest') ?? false);
  readonly splitTime = swimSplitTime;
  readonly duration = (value: number | null) => value === null ? '—' : formatDurationClock(value);
  readonly round = (value: number) => Number(value.toFixed(1));
  readonly reason = (code?: string) => ({
    not_linked: 'No Garmin activity is linked. Link the correct Garmin swim before requesting pool lengths.',
    not_retained: 'No Garmin FIT data is retained for this activity.',
    incomplete_resources: 'Garmin FIT resources are incomplete. Refresh Garmin detail, then try again.',
    missing_session: 'A unique Garmin FIT swim session was not available.',
    no_length_messages: 'No individual FIT length messages were recorded. Split times cannot be reconstructed reliably.',
    not_pool_swim: 'Pool lengths are only available for indoor swims.',
  }[code ?? ''] ?? 'Individual pool lengths are unavailable.');
}
