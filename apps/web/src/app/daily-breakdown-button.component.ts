import { Component } from '@angular/core';
import type { ICellRendererAngularComp } from 'ag-grid-angular';
import type { ICellRendererParams } from 'ag-grid-community';
import type { DailySummaryRow } from './api.service';

export interface DailyBreakdownGridContext {
  openBreakdown: (row: DailySummaryRow) => void;
}

@Component({
  selector: 'sportos-daily-breakdown-button',
  standalone: true,
  template: `
    <button
      type="button"
      class="explain-button"
      [attr.aria-label]="'View score breakdown for ' + date"
      (click)="open()">
      Explain
    </button>
  `,
  styles: [`
    .explain-button {
      min-height: 32px;
      padding: 5px 10px;
      border-radius: 9px;
      font-size: 12px;
      line-height: 1;
    }

    .explain-button:focus-visible {
      outline: 3px solid #93c5fd;
      outline-offset: 2px;
    }
  `],
})
export class DailyBreakdownButtonComponent implements ICellRendererAngularComp {
  private params?: ICellRendererParams<DailySummaryRow, unknown, DailyBreakdownGridContext>;
  date = '';

  agInit(params: ICellRendererParams<DailySummaryRow, unknown, DailyBreakdownGridContext>): void {
    this.setParams(params);
  }

  refresh(params: ICellRendererParams<DailySummaryRow, unknown, DailyBreakdownGridContext>): boolean {
    this.setParams(params);
    return true;
  }

  open(): void {
    const row = this.params?.data;
    if (row) this.params?.context.openBreakdown(row);
  }

  private setParams(params: ICellRendererParams<DailySummaryRow, unknown, DailyBreakdownGridContext>): void {
    this.params = params;
    this.date = params.data?.metric_date ?? '';
  }
}
