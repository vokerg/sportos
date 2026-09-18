import { Component, input, output } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import type { CellValueChangedEvent, ColDef, SuppressKeyboardEventParams } from 'ag-grid-community';
import { DailyQuickEntryActionComponent, type DailyQuickEntryGridContext } from './daily-quick-entry-action.component';
import { formatDate } from './date-time';
import type { ManualDailyFactsInput } from './score-breakdown.models';

export interface DailyQuickEntryGridRow extends ManualDailyFactsInput {
  date: string;
  totalPoints: number;
  scoreStatus: 'imported' | 'calculated' | 'manual';
  saving?: boolean;
  refreshing?: boolean;
  error?: string | null;
}

export interface DailyQuickEntryChange {
  date: string;
  input: ManualDailyFactsInput;
  previous: DailyQuickEntryGridRow;
}

@Component({
  selector: 'sportos-daily-quick-entry-grid',
  standalone: true,
  imports: [AgGridAngular],
  template: `
    <div class="quick-entry-help">
      <div><strong>Quick entry</strong><span>Edit the same facts as the manual form. Enter or ↑/↓ saves and moves; Esc cancels.</span></div>
      <span class="save-note">Each save recalculates the complete day.</span>
    </div>
    <ag-grid-angular
      class="ag-theme-quartz quick-grid"
      theme="legacy"
      aria-label="Editable manual daily facts"
      [rowData]="rows()"
      [columnDefs]="columnDefs"
      [defaultColDef]="defaultColDef"
      [context]="gridContext"
      [singleClickEdit]="true"
      [stopEditingWhenCellsLoseFocus]="true"
      [enterNavigatesVertically]="true"
      [enterNavigatesVerticallyAfterEdit]="true"
      [getRowId]="getRowId"
      (cellValueChanged)="cellChanged($event)">
    </ag-grid-angular>
  `,
  styles: [`
    .quick-entry-help { display: flex; justify-content: space-between; gap: 16px; margin-top: 18px; padding: 12px 14px; border: 1px solid #b8c8ed; border-radius: 12px 12px 0 0; background: #eef3ff; }
    .quick-entry-help div { display: grid; gap: 3px; }
    .quick-entry-help strong { color: #243b73; font-size: 13px; }
    .quick-entry-help span { color: #667085; font-size: 12px; }
    .save-note { align-self: center; }
    .quick-grid { width: 100%; height: min(66vh, 760px); min-height: 500px; }
    @media (max-width: 760px) { .quick-entry-help { flex-direction: column; } }
  `],
})
export class DailyQuickEntryGridComponent {
  readonly rows = input<DailyQuickEntryGridRow[]>([]);
  readonly save = output<DailyQuickEntryChange>();
  readonly refreshFromStrava = output<string>();

  readonly gridContext: DailyQuickEntryGridContext = {
    refreshFromStrava: (date) => this.refreshFromStrava.emit(date),
  };
  readonly getRowId = (params: { data: DailyQuickEntryGridRow }) => params.data.date;
  readonly defaultColDef: ColDef<DailyQuickEntryGridRow> = {
    resizable: true,
    minWidth: 112,
    flex: 1,
    suppressKeyboardEvent: (params) => this.handleVerticalArrow(params),
  };
  readonly columnDefs: ColDef<DailyQuickEntryGridRow>[] = [
    { field: 'date', headerName: 'Date', pinned: 'left', editable: false, width: 140, flex: 0, valueFormatter: (p) => formatDate(p.value) },
    this.numberColumn('steps', 'Steps', true),
    this.kilometerColumn('runIndoorM', 'Run treadmill'),
    this.kilometerColumn('runOutdoorM', 'Run outdoor'),
    this.kilometerColumn('runUnspecifiedM', 'Run other'),
    this.kilometerColumn('bikeIndoorM', 'Bike indoor'),
    this.kilometerColumn('bikeOutdoorM', 'Bike outdoor'),
    this.kilometerColumn('bikeUnspecifiedM', 'Bike other'),
    this.numberColumn('swimM', 'Swim (m)'),
    this.numberColumn('workoutPoints', 'Workout points', true),
    this.numberColumn('bonusPoints', 'Bonus points', true),
    { field: 'totalPoints', headerName: 'Total', editable: false, valueFormatter: (p) => Number(p.value ?? 0).toLocaleString() },
    { field: 'scoreStatus', headerName: 'Authority', editable: false },
    { colId: 'status', headerName: 'Save status', editable: false, valueGetter: (p) => p.data?.saving ? 'Saving…' : p.data?.error || 'Saved', minWidth: 150 },
    { colId: 'refresh', headerName: 'Data', cellRenderer: DailyQuickEntryActionComponent, editable: false, minWidth: 130, sortable: false },
  ];

  cellChanged(event: CellValueChangedEvent<DailyQuickEntryGridRow>): void {
    if (!event.data || event.oldValue === event.newValue) return;
    const field = event.colDef.field as keyof ManualDailyFactsInput;
    const oldValue = DISTANCE_FIELDS.has(field) ? Number(event.oldValue) * 1000 : event.oldValue;
    const previous = { ...event.data, [field]: oldValue };
    this.save.emit({ date: event.data.date, input: toManualInput(event.data), previous });
  }

  private numberColumn(field: keyof ManualDailyFactsInput, headerName: string, integer = false): ColDef<DailyQuickEntryGridRow> {
    return {
      field,
      headerName,
      editable: (p) => !p.data?.saving && !p.data?.refreshing,
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: { min: 0, max: 10_000_000, precision: integer ? 0 : 3 },
      valueParser: (p) => validNumber(p.newValue, integer) ?? p.oldValue,
      valueFormatter: (p) => Number(p.value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 }),
    };
  }

  private kilometerColumn(field: keyof ManualDailyFactsInput, headerName: string): ColDef<DailyQuickEntryGridRow> {
    const column = this.numberColumn(field, `${headerName} (km)`);
    column.valueGetter = (p) => Number(p.data?.[field] ?? 0) / 1000;
    column.valueSetter = (p) => {
      const km = validNumber(p.newValue, false);
      if (km === null || !p.data) return false;
      const meters = Math.round(km * 1_000_000) / 1000;
      if (p.data[field] === meters) return false;
      p.data[field] = meters;
      return true;
    };
    return column;
  }

  private handleVerticalArrow(params: SuppressKeyboardEventParams<DailyQuickEntryGridRow>): boolean {
    if (!params.editing || (params.event.key !== 'ArrowDown' && params.event.key !== 'ArrowUp')) return false;
    const direction = params.event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = Math.max(0, params.node.rowIndex! + direction);
    params.api.stopEditing();
    queueMicrotask(() => params.api.setFocusedCell(nextIndex, params.column.getColId()));
    return true;
  }
}

const DISTANCE_FIELDS = new Set<keyof ManualDailyFactsInput>([
  'runIndoorM', 'runOutdoorM', 'runUnspecifiedM', 'bikeIndoorM', 'bikeOutdoorM', 'bikeUnspecifiedM',
]);

function validNumber(value: unknown, integer: boolean): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10_000_000 || (integer && !Number.isInteger(parsed))) return null;
  return parsed;
}

function toManualInput(row: DailyQuickEntryGridRow): ManualDailyFactsInput {
  return {
    steps: row.steps,
    runIndoorM: row.runIndoorM,
    runOutdoorM: row.runOutdoorM,
    runUnspecifiedM: row.runUnspecifiedM,
    bikeIndoorM: row.bikeIndoorM,
    bikeOutdoorM: row.bikeOutdoorM,
    bikeUnspecifiedM: row.bikeUnspecifiedM,
    swimM: row.swimM,
    workoutPoints: row.workoutPoints,
    bonusPoints: row.bonusPoints,
  };
}
