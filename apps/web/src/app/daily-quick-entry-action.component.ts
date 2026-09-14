import { Component } from '@angular/core';
import type { ICellRendererAngularComp } from 'ag-grid-angular';
import type { ICellRendererParams } from 'ag-grid-community';
import type { DailyQuickEntryGridRow } from './daily-quick-entry-grid.component';

export interface DailyQuickEntryGridContext {
  refreshFromStrava: (date: string) => void;
}

@Component({
  selector: 'sportos-daily-quick-entry-action',
  standalone: true,
  template: `<button type="button" [disabled]="busy" (click)="refresh()">{{ busy ? 'Refreshing…' : 'Refresh Strava' }}</button>`,
  styles: [`button { min-height: 28px; padding: 3px 9px; border-radius: 8px; font-size: 11px; white-space: nowrap; }`],
})
export class DailyQuickEntryActionComponent implements ICellRendererAngularComp {
  private params?: ICellRendererParams<DailyQuickEntryGridRow, unknown, DailyQuickEntryGridContext>;
  busy = false;

  agInit(params: ICellRendererParams<DailyQuickEntryGridRow, unknown, DailyQuickEntryGridContext>): void {
    this.params = params;
    this.busy = params.data?.refreshing ?? false;
  }

  refresh(params?: ICellRendererParams<DailyQuickEntryGridRow, unknown, DailyQuickEntryGridContext>): boolean {
    if (params) {
      this.params = params;
      this.busy = params.data?.refreshing ?? false;
      return true;
    }
    const date = this.params?.data?.date;
    if (date && !this.busy) this.params?.context.refreshFromStrava(date);
    return true;
  }
}
