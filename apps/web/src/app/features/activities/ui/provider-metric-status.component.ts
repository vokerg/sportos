import { Component, input } from '@angular/core';
import { providerMetricState, type ProviderMetricStatus } from '../model/activity-metrics.models';
@Component({selector:'sportos-provider-metric-status',standalone:true,template:`
  <div class="coverage" aria-label="Provider normalization">
    @for (status of statuses(); track status.provider) {
      <span class="provider"><strong>{{ status.provider === 'strava' ? 'Strava' : 'Garmin' }}</strong>
        <span>{{ stateLabel(status) }}</span>
        @if (status.linked) { <span>{{ status.rawRetained === true ? 'Rich raw retained' : status.rawRetained === false ? 'No rich raw retained' : 'Rich raw coverage not checked' }}</span> }
        @if (expanded() && status.linked) {
          <small>{{ status.valueCount }} metrics · {{ status.missingCount }} optional metrics absent · {{ status.rejectedCount }} fields rejected</small>
          @if (status.lastProjectedAt) { <small>Last normalized {{ status.lastProjectedAt }}</small> }
          @if (status.failureCategory) { <small>Retained evidence is safe. Retry normalization.</small> }
        }
      </span>
    }
  </div>`,styles:[`.coverage{display:flex;flex-wrap:wrap;gap:8px}.provider{display:flex;flex-wrap:wrap;gap:5px 9px;padding:6px 10px;border-radius:8px;background:#eef2ff;color:#344054;font-size:12px}.provider small{flex-basis:100%}`]})
export class ProviderMetricStatusComponent { readonly statuses=input<ProviderMetricStatus[]>([]);readonly expanded=input(false);readonly stateLabel=providerMetricState; }
