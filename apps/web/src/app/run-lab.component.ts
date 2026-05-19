import { Component, OnInit, signal } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import type { ColDef } from 'ag-grid-community';
import { ApiService, type PerformanceRow } from './api.service';

@Component({
  selector: 'sportos-run-lab',
  standalone: true,
  imports: [AgGridAngular],
  template: `
    <section class="card">
      <h2>Run Lab</h2>
      <div class="form-row" style="margin-bottom: 12px;">
        <button (click)="load(5000)">5k</button>
        <button (click)="load(10000)">10k</button>
        <button (click)="load(21100)">Half</button>
        <button (click)="load(42195)">Marathon</button>
      </div>
      <ag-grid-angular
        class="ag-theme-quartz"
        style="width: 100%; height: 360px;"
        [rowData]="rows()"
        [columnDefs]="columnDefs"
        [pagination]="true"
        [paginationPageSize]="25">
      </ag-grid-angular>
    </section>
  `,
})
export class RunLabComponent implements OnInit {
  readonly rows = signal<PerformanceRow[]>([]);
  readonly columnDefs: ColDef<PerformanceRow>[] = [
    { field: 'all_time_rank', headerName: '#', width: 90 },
    { field: 'event_date', headerName: 'Date', filter: true },
    { field: 'duration_s', headerName: 'Time (s)', filter: 'agNumberColumnFilter' },
    { field: 'pace_s_per_km', headerName: 'Pace s/km', filter: 'agNumberColumnFilter' },
    { field: 'is_treadmill', headerName: 'Treadmill' },
    { field: 'is_pr_marker', headerName: 'Starred' },
    { field: 'source_rank', headerName: 'Sheet rank' },
    { field: 'tags', headerName: 'Tags' },
  ];

  constructor(private readonly api: ApiService) {}

  ngOnInit() { this.load(5000); }

  load(distanceM: number) {
    this.api.bestPerformance(distanceM).subscribe((rows) => this.rows.set(rows));
  }
}
