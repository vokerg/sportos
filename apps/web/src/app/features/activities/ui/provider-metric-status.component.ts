import { Component, input } from '@angular/core';
import { providerCoverageKind, providerListDescription, providerMetricState, providerNeedsAttention, type ProviderMetricStatus } from '../model/activity-metrics.models';
import { ProviderIconComponent } from '../../../shared/ui/provider-icon.component';
@Component({selector:'sportos-provider-metric-status',standalone:true,imports:[ProviderIconComponent],template:`
  <div class="coverage" [class.concise]="!expanded()" aria-label="Provider status">
    @for (status of statuses(); track status.provider) {
      @if (!expanded()) { @if (status.linked) {
        <span class="source-badge" [attr.data-provider]="status.provider" [attr.data-coverage]="coverage(status)" [class.attention]="attention(status)"
          role="img" [attr.title]="(status.provider === 'strava' ? 'Strava' : 'Garmin') + ': ' + description(status)" [attr.aria-label]="(status.provider === 'strava' ? 'Strava' : 'Garmin') + ': ' + description(status)">
          <sportos-provider-icon [provider]="status.provider" [decorative]="true" />
          <span class="marker" aria-hidden="true">{{ attention(status) ? '!' : coverage(status) === 'detail' ? '✓' : coverage(status) === 'summary' ? 'S' : '?' }}</span>
        </span>
      }
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
  </div>`,styles:[`.coverage{display:flex;flex-wrap:wrap;gap:8px}.provider{display:flex;flex-wrap:wrap;gap:5px 9px;padding:6px 10px;border-radius:8px;background:#eef2ff;color:#344054;font-size:12px}.provider small{flex-basis:100%}.concise{flex-wrap:nowrap;padding:2px 0}.source-badge{--brand:#007cc3;--tint:#eff8ff;--provider-icon-size:22px;--provider-icon-height:24px;position:relative;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border:1px dashed var(--brand);border-radius:10px;background:#fff}.source-badge[data-provider=strava]{--brand:#fc4c02;--tint:#fff4ed}.source-badge[data-coverage=detail]{background:var(--tint);border-style:solid}.source-badge[data-coverage=unknown]{border-color:#98a2b3}.marker{position:absolute;right:-3px;bottom:-3px;display:grid;place-items:center;min-width:13px;height:13px;border:1px solid #d0d5dd;border-radius:50%;background:#fff;color:#475467;font-size:9px;font-weight:800;line-height:1}.source-badge[data-coverage=detail] .marker{background:#16794b;color:white;border-color:#16794b}.source-badge.attention{border-color:#b54708}.source-badge.attention .marker{background:#fff1d6;color:#93370d;border-color:#f7b955}`]})
export class ProviderMetricStatusComponent { readonly statuses=input<ProviderMetricStatus[]>([]);readonly expanded=input(false);readonly stateLabel=providerMetricState;readonly description=providerListDescription;readonly coverage=providerCoverageKind;readonly attention=providerNeedsAttention; }
