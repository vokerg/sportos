import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsCoreOption } from 'echarts/core';
import { Subscription } from 'rxjs';
import {
  ApiService,
  type PerformanceEventDetail,
  type PerformanceEventRow,
} from './api.service';

type ViewState = 'loading' | 'loaded' | 'empty' | 'error';
type DetailState = 'idle' | 'loading' | 'loaded' | 'error';

@Component({
  selector: 'sportos-run-lab',
  standalone: true,
  imports: [NgxEchartsDirective],
  template: `
    <section class="card" aria-labelledby="run-lab-title">
      <h2 id="run-lab-title">Run Lab</h2>
      <p class="help">Review a deterministic distance trend, race/treadmill/PR markers, and the retained source provenance for each event.</p>

      <form class="filter-bar" (submit)="applyFilters(); $event.preventDefault()" aria-label="Run Lab filters">
        <label>Distance
          <select [value]="distanceM()" (change)="distanceM.set(+$any($event.target).value)">
            <option [value]="5000">5 km</option>
            <option [value]="10000">10 km</option>
            <option [value]="21100">Half marathon</option>
            <option [value]="42195">Marathon</option>
          </select>
        </label>
        <label>From <input type="date" [value]="from()" (input)="from.set($any($event.target).value)" /></label>
        <label>To <input type="date" [value]="to()" (input)="to.set($any($event.target).value)" /></label>
        <button type="submit" [disabled]="state() === 'loading'">Apply filters</button>
        <button type="button" class="secondary" (click)="resetFilters()">Reset</button>
      </form>

      @if (state() === 'loading') {
        <p role="status" aria-live="polite">Loading performance events…</p>
      } @else if (state() === 'error') {
        <div class="state-message error" role="alert"><p>{{ errorMessage() }}</p><button type="button" (click)="load()">Retry</button></div>
      } @else if (state() === 'empty') {
        <p class="state-message" role="status">No performance events match these filters.</p>
      } @else {
        <div echarts [options]="chartOptions()" style="height: 280px;" role="img" aria-label="Performance duration trend"></div>
        <div class="table-scroll">
          <table>
            <caption class="visually-hidden">Filtered performance events</caption>
            <thead><tr><th>Date</th><th>Time</th><th>Pace</th><th>Markers</th><th>Rank</th><th>Details</th></tr></thead>
            <tbody>
              @for (row of rows(); track row.id) {
                <tr>
                  <td>{{ row.eventDate }}</td>
                  <td>{{ formatDuration(row.durationS) }}</td>
                  <td>{{ formatPace(row.paceSPerKm) }}/km</td>
                  <td>{{ markers(row) }}</td>
                  <td>{{ row.allTimeRank }}</td>
                  <td><button type="button" (click)="openEvent(row.id)" [attr.aria-label]="'Inspect performance event on ' + row.eventDate">Inspect</button></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (detailState() !== 'idle') {
        <section class="detail-panel" aria-labelledby="performance-detail-title">
          <div class="detail-heading"><h3 id="performance-detail-title">Event detail</h3><button type="button" class="secondary" (click)="closeDetail()">Close</button></div>
          @if (detailState() === 'loading') {
            <p role="status">Loading event provenance…</p>
          } @else if (detailState() === 'error') {
            <p role="alert">{{ detailError() }}</p>
          } @else if (detail()) {
            <dl>
              <div><dt>Date</dt><dd>{{ detail()!.eventDate }}</dd></div>
              <div><dt>Distance</dt><dd>{{ detail()!.distanceM }} m</dd></div>
              <div><dt>Time</dt><dd>{{ formatDuration(detail()!.durationS) }}</dd></div>
              <div><dt>Markers</dt><dd>{{ markers(detail()!) }}</dd></div>
              <div><dt>Source</dt><dd>{{ detail()!.source }}</dd></div>
              <div><dt>Provenance</dt><dd>{{ detail()!.provenance.status }}</dd></div>
              <div><dt>Source record</dt><dd>{{ detail()!.provenance.sourceRecordId ?? 'Not available' }}</dd></div>
              <div><dt>Import batch</dt><dd>{{ detail()!.provenance.importBatchId ?? 'Not available' }}</dd></div>
              <div><dt>Workbook row</dt><dd>{{ workbookRow(detail()!) }}</dd></div>
            </dl>
          }
        </section>
      }
    </section>
  `,
  styles: [`
    .help { margin: -6px 0 16px; color: #667085; font-size: 13px; }
    .table-scroll { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px; border-bottom: 1px solid #e4e7ec; text-align: left; white-space: nowrap; }
    .detail-panel { margin-top: 16px; border-top: 1px solid #e4e7ec; padding-top: 16px; }
    .detail-heading { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
    dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    dl div { padding: 10px; background: #f8fafc; border-radius: 10px; min-width: 0; }
    dt { color: #667085; font-size: 12px; } dd { margin: 4px 0 0; overflow-wrap: anywhere; }
  `],
})
export class RunLabComponent implements OnInit, OnDestroy {
  readonly rows = signal<PerformanceEventRow[]>([]);
  readonly distanceM = signal(5000);
  readonly from = signal('');
  readonly to = signal('');
  readonly state = signal<ViewState>('loading');
  readonly errorMessage = signal<string | null>(null);
  readonly detailState = signal<DetailState>('idle');
  readonly detail = signal<PerformanceEventDetail | null>(null);
  readonly detailError = signal<string | null>(null);

  private listSubscription?: Subscription;
  private detailSubscription?: Subscription;

  readonly chartOptions = computed<EChartsCoreOption>(() => {
    const chronological = [...this.rows()].reverse();
    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 55, right: 20, top: 20, bottom: 45 },
      xAxis: { type: 'category', data: chronological.map((row) => row.eventDate) },
      yAxis: { type: 'value', name: 'Minutes' },
      series: [{ name: 'Duration', type: 'line', data: chronological.map((row) => Number((row.durationS / 60).toFixed(2))), smooth: false }],
    };
  });

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void { this.load(); }

  ngOnDestroy(): void {
    this.listSubscription?.unsubscribe();
    this.detailSubscription?.unsubscribe();
  }

  applyFilters(): void {
    this.closeDetail();
    if (this.from() && this.to() && this.from() > this.to()) {
      this.errorMessage.set('From date must be on or before the to date.');
      this.state.set('error');
      return;
    }
    this.load();
  }

  resetFilters(): void {
    this.distanceM.set(5000);
    this.from.set('');
    this.to.set('');
    this.load();
  }

  load(): void {
    this.closeDetail();
    this.listSubscription?.unsubscribe();
    this.state.set('loading');
    this.errorMessage.set(null);
    this.listSubscription = this.api.performanceEvents({
      distanceM: this.distanceM(),
      from: this.from() || undefined,
      to: this.to() || undefined,
      limit: 500,
    }).subscribe({
      next: (rows) => { this.rows.set(rows); this.state.set(rows.length === 0 ? 'empty' : 'loaded'); },
      error: (error: unknown) => { this.rows.set([]); this.errorMessage.set(this.describeError(error, 'performance events')); this.state.set('error'); },
    });
  }

  openEvent(eventId: string): void {
    this.detailSubscription?.unsubscribe();
    this.detail.set(null);
    this.detailError.set(null);
    this.detailState.set('loading');
    this.detailSubscription = this.api.performanceEvent(eventId).subscribe({
      next: (detail) => { this.detail.set(detail); this.detailState.set('loaded'); },
      error: (error: unknown) => { this.detailError.set(this.describeError(error, 'event detail')); this.detailState.set('error'); },
    });
  }

  closeDetail(): void {
    this.detailSubscription?.unsubscribe();
    this.detail.set(null);
    this.detailError.set(null);
    this.detailState.set('idle');
  }

  formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = Math.round(seconds % 60);
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
      : `${minutes}:${String(remainder).padStart(2, '0')}`;
  }

  formatPace(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
  }

  markers(row: PerformanceEventRow): string {
    const values = [row.isRace ? 'Race' : '', row.isTreadmill ? 'Treadmill' : '', row.isPrMarker || row.isPrByTime ? 'PR' : ''].filter(Boolean);
    return values.length > 0 ? values.join(', ') : '—';
  }

  workbookRow(detail: PerformanceEventDetail): string {
    const provenance = detail.provenance;
    if (provenance.status !== 'available') return provenance.status === 'unsupported' ? 'Unsupported by source' : 'Missing';
    return `${provenance.filename ?? 'source'} / ${provenance.sheetName ?? 'sheet'} / row ${provenance.rowIndex ?? '—'}`;
  }

  private describeError(error: unknown, subject: string): string {
    if (!(error instanceof HttpErrorResponse)) return `The ${subject} request failed unexpectedly.`;
    const body = error.error && typeof error.error === 'object' ? error.error as { message?: string } : null;
    if (error.status === 0) return 'The SportOS API is unavailable. Check that the local API is running.';
    return body?.message || `The ${subject} API returned HTTP ${error.status}.`;
  }
}
