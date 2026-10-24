import { Component, computed, inject, input, output } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { ColorSchemeService } from '../../../core/theme/color-scheme.service';
import { formatDurationClock } from '../../../shared/util/duration';
import { swimSplitTime } from '../model/swim-length-chart.models';
import { runLapChart, type LapSource, type RunLaps } from '../model/run-laps.models';

@Component({
  selector:'sportos-run-laps', standalone:true, imports:[NgxEchartsDirective],
  template:`
    <section class="card" aria-labelledby="run-laps-title">
      <div class="heading"><div><h2 id="run-laps-title">Run laps</h2><p>Recorded lap splits from retained provider data.</p></div>
        <div class="actions" role="group" aria-label="Lap data source">
          @for (provider of sources; track provider) { <button type="button" [attr.aria-pressed]="source() === provider" (click)="load.emit(provider)">{{ provider === 'strava' ? 'Strava' : 'Garmin' }}</button> }
          <button type="button" [disabled]="state() === 'loading'" (click)="load.emit(source())">{{ state() === 'loading' ? 'Loading…' : state() === 'idle' ? 'Load laps' : 'Reload laps' }}</button>
        </div>
      </div>
      @if (state() === 'idle') { <p>Load retained laps to view split times, pace and heart rate.</p> }
      @else if (state() === 'loading') { <p role="status">Reading retained {{ source() }} laps…</p> }
      @else if (state() === 'error' || state() === 'missing') { <p role="alert">Could not read retained {{ source() }} laps. Use Fetch detail under Provider data if missing, then retry.</p> }
      @else {
        @if (data().rows.length) {
          <p>{{ data().rows.length }} recorded {{ source() === 'strava' ? 'Strava' : 'Garmin' }} laps. Laps may have different distances and include recovery intervals.</p>
          @if (source() === 'garmin') { <p>Garmin overview shows up to 100 laps; completeness is not verified.</p> }
          @if (data().bounded) { <p role="alert">The display limit was reached. This view may omit later laps.</p> }
          @if (chart(); as chart) { <div echarts [theme]="colorScheme.chartTheme()" [options]="chart.options" [notMerge]="true" [style.height.px]="chart.height" role="img" aria-label="Running pace per kilometre and average heart rate by recorded lap"></div> }
          <div class="table-scroll"><table><thead><tr><th scope="col">Lap</th><th scope="col">Distance</th><th scope="col">Split</th><th scope="col">Elapsed</th><th scope="col">Pace /km</th><th scope="col">Avg HR</th></tr></thead><tbody>
            @for (lap of data().rows; track lap.row) { <tr><td>{{ lap.row }}</td><td>{{ metres(lap.distanceM) }}</td><td>{{ splitTime(lap.durationS) }} <small>{{ lap.durationBasis }}</small></td><td>{{ splitTime(lap.elapsedS) }}</td><td>{{ duration(lap.paceSPerKm) }}</td><td>{{ lap.heartRate === null ? '—' : round(lap.heartRate) + ' bpm' }}</td></tr> }
          </tbody></table></div>
          <p class="note">Pace uses each recorded lap's distance and {{ source() === 'strava' ? 'moving' : 'timer' }} time, falling back to elapsed time only when missing. Zero-distance laps have no pace. Missing values remain gaps. Provider laps can differ from corrected activity totals; these splits do not change activity facts or scoring.</p>
        } @else { <p>No recorded laps are available in retained {{ source() }} data. Use Fetch detail under Provider data if needed, then reload laps. Splits are not reconstructed.</p> }
      }
    </section>`,
  styles:[`:host{display:block;margin:16px 0}.heading,.actions{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}h2{margin:0;font-size:19px}p,small{color:var(--text-muted)}button[aria-pressed=true]{outline:2px solid var(--link);outline-offset:2px}.table-scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left;font-variant-numeric:tabular-nums}th,td{padding:10px 12px;border-bottom:1px solid var(--border);white-space:nowrap}th,.note{font-size:12px}small{font-size:10px}.note{line-height:1.6}`],
})
export class RunLapsComponent {
  readonly colorScheme = inject(ColorSchemeService);
  readonly sources = ['strava','garmin'] as const;
  readonly source = input<LapSource>('strava');
  readonly state = input<'idle'|'loading'|'loaded'|'missing'|'error'>('idle');
  readonly data = input<RunLaps>({rows:[],bounded:false});
  readonly load = output<LapSource>();
  readonly chart = computed(()=>runLapChart(this.data()));
  readonly splitTime = swimSplitTime;
  readonly duration = (value:number|null)=>value===null?'—':formatDurationClock(value);
  readonly round = (value:number)=>Number(value.toFixed(1));
  readonly metres = (value:number|null)=>value===null?'—':`${value.toLocaleString(undefined,{maximumFractionDigits:2})} m`;
}
