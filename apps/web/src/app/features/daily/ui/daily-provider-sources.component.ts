import { Component } from '@angular/core';
import type { ICellRendererAngularComp } from 'ag-grid-angular';
import type { ICellRendererParams } from 'ag-grid-community';
import type { DailySummaryRow } from '../model/daily.models';

@Component({
  selector: 'sportos-daily-provider-sources', standalone: true,
  template: `
    <span class="sources">
      @if (sources.strava) {
        <svg role="img" aria-label="Strava records retained" viewBox="0 0 24 24"><title>Strava records retained</title><path fill="#fc4c02" d="M10 2 2 16h5l3-5 3 5h5L10 2zm8 11-3 5h-4l7 6 6-11h-6z" /></svg>
      }
      @if (sources.garmin) {
        <svg role="img" aria-label="Garmin records retained" viewBox="0 0 24 24"><title>Garmin records retained</title><path fill="#007cc3" d="m12 1 7 9H5z" /><text x="12" y="23" text-anchor="middle" font-size="15" font-weight="700" fill="#344054">G</text></svg>
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
