import { Component } from '@angular/core';
import type { ICellRendererAngularComp } from 'ag-grid-angular';
import type { ICellRendererParams } from 'ag-grid-community';
import type { DailySummaryRow } from '../model/daily.models';
import { ProviderIconComponent } from '../../../shared/ui/provider-icon.component';

@Component({
  selector: 'sportos-daily-provider-sources', standalone: true, imports: [ProviderIconComponent],
  template: `
    <span class="sources">
      @if (sources.strava) {
        <sportos-provider-icon provider="strava" label="Strava records retained" />
      }
      @if (sources.garmin) {
        <sportos-provider-icon provider="garmin" label="Garmin records retained" />
      }
    </span>
  `,
  styles: [`:host { display: inline-flex; align-items: center; height: 100%; }.sources { display: inline-flex; gap: 7px; align-items: center; }svg { width: 18px; height: 20px; }`],
})
export class DailyProviderSourcesComponent implements ICellRendererAngularComp {
  sources = { strava: false, garmin: false };
  agInit(params: ICellRendererParams<DailySummaryRow>): void { this.refresh(params); }
  refresh(params: ICellRendererParams<DailySummaryRow>): boolean {
    this.sources = params.data?.providerSources ?? { strava: false, garmin: false };
    return true;
  }
}
