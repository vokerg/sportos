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
      class="details-link"
      [attr.aria-label]="'View score breakdown for ' + date"
      (click)="open()">
      <span>View details</span>
      <span class="details-arrow" aria-hidden="true">→</span>
    </button>
  `,
  styles: [`
    .details-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-height: 32px;
      padding: 4px 0;
      border: 0;
      background: transparent;
      color: #5267a8;
      font-size: 12px;
      font-weight: 650;
      line-height: 1.2;
      text-decoration: underline;
      text-decoration-color: transparent;
      text-underline-offset: 3px;
      cursor: pointer;
      white-space: nowrap;
    }

    .details-link:hover {
      color: #243b73;
      text-decoration-color: currentColor;
    }

    .details-link:focus-visible {
      outline: 3px solid #a8b9ef;
      outline-offset: 3px;
      border-radius: 4px;
    }

    .details-arrow {
      font-size: 14px;
      transition: transform 150ms ease;
    }

    .details-link:hover .details-arrow {
      transform: translateX(2px);
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
