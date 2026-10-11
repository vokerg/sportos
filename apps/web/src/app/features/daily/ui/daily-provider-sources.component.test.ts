import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { DailyProviderSourcesComponent } from './daily-provider-sources.component';
describe('daily provider source icons', () => {
  it('replaces icons when AG Grid reuses a cell and clears missing evidence', () => {
    const cell = new DailyProviderSourcesComponent();
    cell.agInit({ data: { providerSources: { strava: true, garmin: false } } } as never);
    expect(cell.sources).toEqual({ strava: true, garmin: false });
    cell.refresh({ data: { providerSources: { strava: false, garmin: true } } } as never);
    expect(cell.sources).toEqual({ strava: false, garmin: true });
    cell.refresh({ data: undefined } as never);
    expect(cell.sources).toEqual({ strava: false, garmin: false });
  });
});
