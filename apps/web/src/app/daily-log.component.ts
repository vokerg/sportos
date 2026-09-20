import { DecimalPipe } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import type { DailySummaryRow } from './features/daily/model/daily.models';
import { DailyLogFiltersComponent } from './daily-log-filters.component';
import { DailyLogGridComponent } from './daily-log-grid.component';
import { DailyLogTrendComponent } from './daily-log-trend.component';
import { DailyQuickEntryGridComponent } from './daily-quick-entry-grid.component';
import type { DailyQuickEntryChange } from './features/daily/model/daily-quick-entry.models';
import { DailyLogStore } from './features/daily/state/daily-log.store';
import type { ManualDailyFactsInput } from './score-breakdown.models';
import { DailyQuickSheetComponent } from './daily-quick-sheet.component';

@Component({
  selector: 'sportos-daily-log',
  standalone: true,
  providers: [DailyLogStore],
  imports: [
    DecimalPipe,
    DailyLogFiltersComponent,
    DailyLogTrendComponent,
    DailyLogGridComponent,
    DailyQuickEntryGridComponent,
    DailyQuickSheetComponent,
  ],
  template: `
    <section class="card" aria-labelledby="daily-log-title">
      <div class="daily-log-header">
        <div>
          <h2 id="daily-log-title">Daily Log</h2>
          <p class="daily-log-help">Open a chart bar or table row to inspect the complete day.</p>
        </div>
        <div class="current-average" aria-label="Current 30 day average">
          <span>Current 30d average</span>
          <strong>{{ latestAverage() === null ? '—' : (latestAverage() | number:'1.0-0') }}</strong>
        </div>
      </div>

      <sportos-daily-log-filters
        [quickRange]="quickRange()"
        [from]="from()"
        [to]="to()"
        [loading]="summaryState() === 'loading'"
        (quickRangeChange)="setQuickRange($event)"
        (fromChange)="setFrom($event)"
        (toChange)="setTo($event)"
        (apply)="applyFilters()"
        (reset)="resetFilters()" />

      <div class="view-switch" role="group" aria-label="Daily log view">
        <button type="button" [class.active]="viewMode() === 'summary'" (click)="showSummary()">Summary</button>
        <button type="button" [class.active]="viewMode() === 'quick-entry'" (click)="showQuickEntry()">Quick entry</button>
      </div>

      @if (viewMode() === 'summary') {
        @if (summaryState() === 'loading') {
          <p role="status" aria-live="polite">Loading daily summaries…</p>
        } @else if (summaryState() === 'error') {
          <div class="state-message error" role="alert"><p>{{ summaryError() }}</p><button type="button" (click)="loadRows()">Retry</button></div>
        } @else if (summaryState() === 'empty') {
          <p class="state-message" role="status">No canonical daily summaries match this range.</p>
        } @else {
          <sportos-daily-log-trend [rows]="rows()" (openDay)="openBreakdownForDate($event)" />
          <sportos-daily-log-grid [rows]="rows()" (openBreakdown)="openBreakdown($event)" />
        }
      } @else {
        @if (quickEntryState() === 'loading') {
          <p role="status">Loading editable facts…</p>
        } @else if (quickEntryState() === 'error') {
          <div class="state-message error" role="alert"><p>{{ quickEntryError() }}</p><button type="button" (click)="loadQuickEntryRows()">Retry</button></div>
        } @else {
          <sportos-daily-quick-entry-grid
            [rows]="quickEntryRows()"
            (save)="saveQuickEntry($event)"
            (refreshFromStrava)="refreshQuickEntryFromStrava($event)" />
        }
      }

      <sportos-daily-quick-sheet
        [state]="breakdownState()"
        [date]="selectedDate()"
        [breakdown]="breakdown()"
        [errorMessage]="breakdownError()"
        [recalculating]="recalculationState() === 'working'"
        [recalculationError]="recalculationError()"
        [savingManual]="manualSaveState() === 'working'"
        [manualSaveError]="manualSaveError()"
        [manualEditRequestId]="manualEditRequestId()"
        (retry)="retryBreakdown()"
        (recalculate)="recalculateSelectedDate()"
        (saveManualFacts)="saveManualFacts($event)"
        (opened)="openFullDay()"
        (closed)="closeBreakdown()" />
    </section>
  `,
  styles: [`
    .daily-log-header { display: flex; align-items: start; justify-content: space-between; gap: 20px; margin-bottom: 16px; }
    .daily-log-header h2 { margin-bottom: 6px; }
    .daily-log-help { margin: 0; color: #667085; font-size: 13px; }
    .current-average { display: grid; flex: 0 0 auto; gap: 3px; min-width: 150px; padding: 10px 14px; border-radius: 12px; background: #eef3ff; }
    .current-average span { color: #667085; font-size: 11px; font-weight: 650; }
    .current-average strong { color: #172b4d; font-size: 22px; }
    .view-switch { display: flex; gap: 4px; width: fit-content; padding: 4px; border: 1px solid #dbe4f0; border-radius: 10px; background: #f8fafc; }
    .view-switch button { border-color: transparent; background: transparent; color: #667085; }
    .view-switch button.active { border-color: #b8c8ed; background: #fff; color: #243b73; box-shadow: 0 1px 2px rgba(16, 24, 40, .08); }
    @media (max-width: 640px) { .daily-log-header { align-items: stretch; flex-direction: column; } .current-average { min-width: 0; } }
  `],
})
export class DailyLogComponent implements OnInit {
  get rows() { return this.state.rows; }
  get latestAverage() { return this.state.latestAverage; }
  get from() { return this.state.from; }
  get to() { return this.state.to; }
  get quickRange() { return this.state.quickRange; }
  get summaryState() { return this.state.summaryState; }
  get summaryError() { return this.state.summaryError; }
  get selectedDate() { return this.state.selectedDate; }
  get breakdownState() { return this.state.breakdownState; }
  get breakdown() { return this.state.breakdown; }
  get breakdownError() { return this.state.breakdownError; }
  get recalculationState() { return this.state.recalculationState; }
  get recalculationError() { return this.state.recalculationError; }
  get manualSaveState() { return this.state.manualSaveState; }
  get manualSaveError() { return this.state.manualSaveError; }
  get manualEditRequestId() { return this.state.manualEditRequestId; }
  get viewMode() { return this.state.viewMode; }
  get quickEntryRows() { return this.state.quickEntryRows; }
  get quickEntryState() { return this.state.quickEntryState; }
  get quickEntryError() { return this.state.quickEntryError; }

  constructor(
    readonly state: DailyLogStore,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    this.state.initialize();
  }

  applyFilters(): void {
    this.state.applyFilters();
  }

  setFrom(value: string): void {
    this.state.setFrom(value);
  }

  setTo(value: string): void {
    this.state.setTo(value);
  }

  setQuickRange(value: string): void {
    this.state.setQuickRange(value);
  }

  resetFilters(): void {
    this.state.resetFilters();
  }

  showSummary(): void {
    this.state.showSummary();
  }

  showQuickEntry(): void {
    this.state.showQuickEntry();
  }

  addQuickEntryDate(date: string): void {
    this.state.addQuickEntryDate(date);
  }

  loadQuickEntryRows(): void {
    this.state.loadQuickEntryRows();
  }

  saveQuickEntry(change: DailyQuickEntryChange): void {
    this.state.saveQuickEntry(change);
  }

  refreshQuickEntryFromStrava(date: string): void {
    this.state.refreshQuickEntryFromStrava(date);
  }

  loadRows(): void {
    this.state.loadRows();
  }

  openBreakdown(row: DailySummaryRow): void {
    this.state.openBreakdown(row);
  }

  openBreakdownForDate(date: string): void {
    this.state.openBreakdownForDate(date);
  }

  openManualEntry(date: string): void {
    this.state.openManualEntry(date);
  }

  openFullDay(edit = false): void {
    const date = this.selectedDate();
    if (!date) return;
    void this.router.navigate(['/daily', date], {
      queryParams: edit ? { edit: 'true' } : undefined,
    });
  }

  saveManualFacts(input: ManualDailyFactsInput): void {
    this.state.saveManualFacts(input);
  }

  recalculateSelectedDate(date?: string): void {
    this.state.recalculateSelectedDate(date);
  }

  retryBreakdown(): void {
    this.state.retryBreakdown();
  }

  closeBreakdown(): void {
    this.state.closeBreakdown();
  }
}
