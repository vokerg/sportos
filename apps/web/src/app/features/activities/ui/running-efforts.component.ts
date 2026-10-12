import { Component, computed, input, output } from '@angular/core';
import { availableEffort, effortDistance, effortMethod, effortProviderState, effortReason, effortStatus, effortTime, visibleEffortTargets, type RunningEfforts } from '../model/running-efforts.models';
@Component({
  selector: 'sportos-running-efforts', standalone: true,
  template: `
    <section class="card" aria-labelledby="running-efforts-title">
      <div class="heading"><h2 id="running-efforts-title">Best efforts</h2><button type="button" [disabled]="loading()" (click)="reprocess.emit()">{{ loading() ? 'Calculating…' : 'Calculate retained efforts' }}</button></div>
      <p>Pause-excluded running analysis. Calculated windows use each provider independently; estimates use uniform average pace. These are not certified personal records.</p>
      @if (error()) { <p role="alert">{{ error() }}</p> }
      @if (data(); as data) {
        @if (targets().length) {
        <div class="table-wrap"><table><caption class="visually-hidden">Running efforts by distance and source</caption><thead><tr><th scope="col">Distance</th><th scope="col">Strava</th><th scope="col">Garmin</th></tr></thead><tbody>
        @for (target of targets(); track target) { <tr><th scope="row">{{ distance(target) }}</th>
          @for (provider of data.providers; track provider.provider) {
            <td>@for (effort of provider.efforts; track effort.targetDistanceM) { @if (effort.targetDistanceM === target) {
              @if (available(provider, effort)) { <strong>{{ time(effort.durationS) }}</strong>
              <span class="status" [class.estimated]="effort.status === 'estimated'">{{ status(provider, effort) }}</span>
              <small>{{ method(effort.method) }}</small>
              @if (effort.reason) { <small class="reason">{{ reason(effort.reason) }}</small> }
              } @else { <span aria-label="No current effort for this provider">{{ providerState(provider) || '—' }}</span> }
            } }</td>
          }
        </tr> }
        </tbody></table></div>
        } @else { <p>No retained efforts cover these distances.</p> }
        <details><summary>Calculation and coverage</summary>
          @for (provider of data.providers; track provider.provider) {
            <h3>{{ provider.provider === 'strava' ? 'Strava' : 'Garmin' }} @if (providerState(provider)) { · {{ providerState(provider) }} }</h3>
            @if (provider.state === 'current' && provider.projectedAt) { <p>Calculated {{ provider.projectedAt }} · algorithm v{{ provider.algorithmVersion }}</p> }
            @for (effort of provider.efforts; track effort.targetDistanceM) {
              @if (available(provider, effort)) {
              <p>{{ distance(effort.targetDistanceM) }} · {{ status(provider, effort) }} · {{ method(effort.method) }}
              @if (effort.sourceDistanceM !== null) { · recorded {{ effort.sourceDistanceM }} m }
              @if (effort.coverageDistanceM !== null) { · covered {{ effort.coverageDistanceM }} m }
              · pause coverage: {{ effort.pauseCoverage }}
              @if (effort.startOffsetS !== null) { · window {{ effort.startOffsetS }}–{{ effort.endOffsetS }} seconds from first sample }
              @if (effort.reason) { · {{ reason(effort.reason) }} }</p>
              }
            }
          }
        </details>
      } @else { <p>Retained efforts are unavailable. Reload the activity after checking deployment.</p> }
      <p class="hint">Calculate retained efforts makes no provider requests. Use Fetch Strava detail below for this run to upgrade an estimate when usable streams are available.</p>
    </section>
  `,
  styles: [`:host{display:block;margin-top:16px}.heading{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}h2{margin:0;font-size:18px}p{color:#667085;font-size:13px}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;min-width:420px}th,td{padding:12px;text-align:left;border-bottom:1px solid #e4e7ec;vertical-align:top}th{font-size:13px}td strong{font-size:18px;margin-right:8px}.status{font-size:12px;font-weight:700;color:#344054}.estimated{color:#8a5700}small{display:block;margin-top:4px;color:#667085}.reason{font-size:11px}summary{cursor:pointer;margin-top:12px;font-size:13px;font-weight:600}.hint{margin-bottom:0}button:disabled{opacity:.55}`],
})
export class RunningEffortsComponent {
  readonly data = input<RunningEfforts | null>(null); readonly loading = input(false); readonly error = input(''); readonly reprocess = output<void>();
  readonly targets = computed(() => this.data() ? visibleEffortTargets(this.data()!) : []);
  readonly available = availableEffort; readonly providerState = effortProviderState;
  readonly distance = effortDistance; readonly time = effortTime; readonly method = effortMethod; readonly status = effortStatus; readonly reason = effortReason;
}
