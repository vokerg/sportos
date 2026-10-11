import { Component, input } from '@angular/core';
import { providerListDescription, providerListState, providerMetricState, type ProviderMetricStatus } from '../model/activity-metrics.models';
@Component({selector:'sportos-provider-metric-status',standalone:true,template:`
  <div class="coverage" [class.concise]="!expanded()" aria-label="Provider status">
    @for (status of statuses(); track status.provider) {
      @if (!expanded()) {
        <span class="provider" [attr.title]="description(status)" [attr.aria-label]="status.provider + ': ' + description(status)"><strong>{{ status.provider === 'strava' ? 'Strava' : 'Garmin' }}</strong><span>· {{ listState(status) }}</span></span>
      } @else {
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
    }
  </div>`,styles:[`.coverage{display:flex;flex-wrap:wrap;gap:8px}.provider{display:flex;flex-wrap:wrap;gap:5px 9px;padding:6px 10px;border-radius:8px;background:#eef2ff;color:#344054;font-size:12px}.provider small{flex-basis:100%}.concise{flex-wrap:nowrap}.concise .provider{white-space:nowrap;gap:4px;padding:3px 7px;font-size:11px}`]})
export class ProviderMetricStatusComponent { readonly statuses=input<ProviderMetricStatus[]>([]);readonly expanded=input(false);readonly stateLabel=providerMetricState;readonly listState=providerListState;readonly description=providerListDescription; }
