import { Component } from '@angular/core';
import type { ICellRendererAngularComp } from 'ag-grid-angular';
import type { ICellRendererParams } from 'ag-grid-community';
import type { DailySummaryRow } from './api.service';
import { formatDate } from './date-time';

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
      [attr.aria-label]="'View score breakdown for ' + formatDate(date)"
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
      padding: 5px 8px;
      border: 1px solid #c8d4f0;
      border-radius: 8px;
      background: #f8faff;
      color: #3959a6;
      font-size: 12px;
      font-weight: 650;
      line-height: 1.2;
      cursor: pointer;
      white-space: nowrap;
      transition: border-color 150ms ease, background 150ms ease, color 150ms ease, box-shadow 150ms ease;
    }

    .details-link:hover {
      color: #243b73;
      border-color: #8fa5df;
      background: #eef3ff;
      box-shadow: 0 2px 6px rgba(36, 59, 115, .12);
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

  formatDate(value: string): string {
    return formatDate(value);
  }

  private setParams(params: ICellRendererParams<DailySummaryRow, unknown, DailyBreakdownGridContext>): void {
    this.params = params;
    this.date = params.data?.metric_date ?? '';
  }
}
