import { Component } from '@angular/core';
import type { ICellRendererAngularComp } from 'ag-grid-angular';
import type { ICellRendererParams } from 'ag-grid-community';
import type { DailySummaryRow } from './features/daily/model/daily.models';
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
      color: var(--text-muted);
      font-size: 24px;
      font-weight: 400;
      line-height: 1;
      cursor: pointer;
      white-space: nowrap;
      transition: border-color 150ms ease, background 150ms ease, color 150ms ease, transform 150ms ease;
    }

    .details-link:hover {
      color: var(--link);
      border-color: var(--border-accent);
      background: var(--accent-surface);
      transform: translateX(1px);
    }

    .details-link:focus-visible {
      outline: 3px solid var(--accent-surface);
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
