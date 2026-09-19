import { Component, computed, input, output, signal } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import type { CellStyle, ColDef, GridApi, GridReadyEvent } from 'ag-grid-community';
import type { DailySummaryRow } from './api.service';
import {
  DailyBreakdownButtonComponent,
  type DailyBreakdownGridContext,
} from './daily-breakdown-button.component';
import {
  DAILY_LOG_PAGE_SIZES,
  dailyScoreStatusLabel,
  formatDailyCellNumber,
  formatDailyMeters,
  compareDailyNumbers,
  positiveMetricRange,
  relativePastelBackground,
} from './daily-log.view-model';
import { formatDate } from './date-time';
import { formatSwimMeters } from './swim-distance';

@Component({
  selector: 'sportos-daily-log-grid',
  standalone: true,
  imports: [AgGridAngular],
  template: `
    <div class="daily-grid-toolbar">
      <div>
        <span class="table-kicker">Daily entries</span>
        <strong>Canonical daily summaries</strong>
      </div>
      <label>Rows per page
        <select [value]="pageSize()" (change)="setPageSize($any($event.target).value)">
          @for (size of paginationPageSizeSelector; track size) {
            <option [value]="size">{{ size }}</option>
          }
        </select>
      </label>
    </div>

    <ag-grid-angular
      class="ag-theme-quartz daily-grid"
      theme="legacy"
      aria-label="Daily scores. Use the open action in a row to view canonical facts and source provenance."
      [rowData]="rows()"
      [columnDefs]="columnDefs"
      [defaultColDef]="defaultColDef"
      [context]="gridContext"
      [icons]="gridIcons"
      [pagination]="true"
      [paginationPageSize]="pageSize()"
      [paginationPageSizeSelector]="false"
      [rowHeight]="32"
      [headerHeight]="36"
      domLayout="autoHeight"
      (gridReady)="onGridReady($event)">
    </ag-grid-angular>
  `,
  styles: [`
    .daily-grid-toolbar { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-top: 18px; padding: 12px 14px; border: 1px solid #dbe4f0; border-radius: 12px 12px 0 0; background: #f8faff; }
    .daily-grid-toolbar > div { display: grid; gap: 3px; min-width: 0; }
    .daily-grid-toolbar strong { color: #243b73; font-size: 13px; }
    .table-kicker { color: #5368ae; font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
    .daily-grid-toolbar label { display: grid; gap: 5px; }
    .daily-grid-toolbar select { min-width: 104px; min-height: 34px; padding: 6px 24px 6px 9px; border-radius: 9px; font-size: 12px; font-weight: 700; }
    .daily-grid { width: 100%; }
    .daily-grid .ag-paging-panel { min-height: 54px; height: auto; padding: 8px 12px; gap: 6px; }
    .daily-grid .ag-paging-description { color: #667085; font-size: 12px; font-weight: 650; white-space: nowrap; }
    .daily-grid .ag-paging-button { display: inline-flex; align-items: center; justify-content: center; min-width: 48px; min-height: 34px; padding: 0 9px; border: 1px solid #d0d5dd; border-radius: 9px; background: #fff; color: #344054; font-size: 12px; font-weight: 750; line-height: 1; }
    .daily-grid .ag-paging-button:hover:not(.ag-disabled) { border-color: #8fa5df; background: #eef3ff; color: #243b73; }
    .daily-grid .ag-paging-button.ag-disabled { border-color: #eaecf0; background: #f8fafc; color: #98a2b3; opacity: 1; }
    .daily-grid .ag-paging-button:focus-visible { outline: 3px solid #f59e0b; outline-offset: 2px; }
  `],
})
export class DailyLogGridComponent {
  readonly rows = input<DailySummaryRow[]>([]);
  readonly openBreakdown = output<DailySummaryRow>();

  readonly paginationPageSizeSelector = [...DAILY_LOG_PAGE_SIZES];
  readonly pageSize = signal(100);
  private gridApi?: GridApi<DailySummaryRow>;
  private readonly metricRanges = computed(() => ({
    steps: positiveMetricRange(this.rows().map((row) => row.steps)),
    run_m: positiveMetricRange(this.rows().map((row) => row.run_m)),
    bike_m: positiveMetricRange(this.rows().map((row) => row.bike_m)),
    swim_m: positiveMetricRange(this.rows().map((row) => row.swim_m)),
    workout_points: positiveMetricRange(this.rows().map((row) => row.workout_points)),
    bonus_points: positiveMetricRange(this.rows().map((row) => row.bonus_points)),
    total_points: positiveMetricRange(this.rows().map((row) => row.total_points)),
    avg_30d: positiveMetricRange(this.rows().map((row) => row.avg_30d)),
  }));

  readonly gridContext: DailyBreakdownGridContext = {
    openBreakdown: (row) => this.openBreakdown.emit(row),
  };

  readonly gridIcons = {
    first: '<span>First</span>',
    previous: '<span>Prev</span>',
    next: '<span>Next</span>',
    last: '<span>Last</span>',
  };

  readonly defaultColDef: ColDef<DailySummaryRow> = {
    sortable: true,
    resizable: true,
    filter: true,
    minWidth: 112,
    flex: 1,
  };

  readonly columnDefs: ColDef<DailySummaryRow>[] = [
    {
      colId: 'scoreBreakdown',
      headerName: 'Details',
      cellRenderer: DailyBreakdownButtonComponent,
      pinned: 'left',
      width: 72,
      minWidth: 72,
      maxWidth: 72,
      sortable: false,
      filter: false,
      suppressHeaderMenuButton: true,
    },
    {
      field: 'metric_date',
      headerName: 'Date',
      pinned: 'left',
      width: 150,
      minWidth: 150,
      flex: 0,
      valueFormatter: (params) => formatDate(params.value),
    },
    { field: 'score_status', headerName: 'Authority', valueFormatter: (params) => dailyScoreStatusLabel(params.value) },
    { field: 'steps', headerName: 'Steps', filter: 'agNumberColumnFilter', comparator: compareDailyNumbers, valueFormatter: (params) => formatDailyCellNumber(params.value), cellStyle: (params) => this.metricCellStyle('steps', params.value, '203, 176, 110') },
    { field: 'run_m', headerName: 'Run', filter: 'agNumberColumnFilter', comparator: compareDailyNumbers, valueFormatter: (params) => formatDailyMeters(params.value), cellStyle: (params) => this.metricCellStyle('run_m', params.value, '116, 168, 132') },
    { field: 'bike_m', headerName: 'Bike', filter: 'agNumberColumnFilter', comparator: compareDailyNumbers, valueFormatter: (params) => formatDailyMeters(params.value), cellStyle: (params) => this.metricCellStyle('bike_m', params.value, '119, 151, 194') },
    { field: 'swim_m', headerName: 'Swim', filter: 'agNumberColumnFilter', comparator: compareDailyNumbers, valueFormatter: (params) => formatSwimMeters(params.value), cellStyle: (params) => this.metricCellStyle('swim_m', params.value, '104, 174, 183') },
    { field: 'workout_points', headerName: 'Workout', filter: 'agNumberColumnFilter', comparator: compareDailyNumbers, valueFormatter: (params) => formatDailyCellNumber(params.value), cellStyle: (params) => this.metricCellStyle('workout_points', params.value, '176, 139, 190') },
    { field: 'bonus_points', headerName: 'Bonus', filter: 'agNumberColumnFilter', comparator: compareDailyNumbers, valueFormatter: (params) => formatDailyCellNumber(params.value), cellStyle: (params) => this.metricCellStyle('bonus_points', params.value, '193, 151, 174') },
    { field: 'total_points', headerName: 'SportOS total', filter: 'agNumberColumnFilter', comparator: compareDailyNumbers, valueFormatter: (params) => formatDailyCellNumber(params.value), cellStyle: (params) => this.metricCellStyle('total_points', params.value, '99, 129, 184') },
    { field: 'avg_30d', headerName: '30d average', filter: 'agNumberColumnFilter', comparator: compareDailyNumbers, valueFormatter: (params) => formatDailyCellNumber(params.value), cellStyle: (params) => this.metricCellStyle('avg_30d', params.value, '128, 164, 111') },
  ];

  private metricCellStyle(
    field: keyof ReturnType<typeof this.metricRanges>,
    value: unknown,
    rgb: string,
  ): CellStyle | undefined {
    const backgroundColor = relativePastelBackground(value, this.metricRanges()[field], rgb);
    return backgroundColor ? { backgroundColor } : undefined;
  }

  onGridReady(event: GridReadyEvent<DailySummaryRow>): void {
    this.gridApi = event.api;
    this.gridApi.setGridOption('paginationPageSize', this.pageSize());
  }

  setPageSize(value: string): void {
    const nextPageSize = Number(value);
    if (!DAILY_LOG_PAGE_SIZES.includes(nextPageSize as (typeof DAILY_LOG_PAGE_SIZES)[number])) return;
    this.pageSize.set(nextPageSize);
    this.gridApi?.setGridOption('paginationPageSize', nextPageSize);
  }
}
