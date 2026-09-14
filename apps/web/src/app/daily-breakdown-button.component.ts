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
      [attr.title]="'View score breakdown for ' + formatDate(date)"
      (click)="open()">
      <span aria-hidden="true">›</span>
    </button>
  `,
  styles: [`
    .details-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      padding: 0;
      border: 1px solid transparent;
      border-radius: 50%;
      background: transparent;
      color: #60709a;
      font-size: 24px;
      font-weight: 400;
      line-height: 1;
      cursor: pointer;
      white-space: nowrap;
      transition: border-color 150ms ease, background 150ms ease, color 150ms ease, transform 150ms ease;
    }

    .details-link:hover {
      color: #243b73;
      border-color: #d5ddef;
      background: #f1f4fa;
      transform: translateX(1px);
    }

    .details-link:focus-visible {
      outline: 3px solid #a8b9ef;
      outline-offset: 3px;
      border-radius: 50%;
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
