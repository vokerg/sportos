import { DistanceLeaderboardComponent } from './features/performance/pages/distance-leaderboard.component';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { PerformanceApiService } from './features/performance/data-access/performance-api.service';
import type { PerformanceEventDetail, PerformanceEventRow } from './features/performance/model/performance.models';
import { formatDate } from './date-time';
type DetailState = 'idle' | 'loading' | 'loaded' | 'error';
@Component({
  selector: 'sportos-run-lab', standalone: true,
  imports: [DistanceLeaderboardComponent, RouterLink],
  template: `
    <sportos-distance-leaderboard (inspect)="openEvent($event)" (viewChange)="closeDetail()" />
      @if (detailState() !== 'idle') {
        <section class="card detail-panel" aria-labelledby="performance-detail-title">
          <div class="detail-heading"><h3 id="performance-detail-title">Original record</h3><button type="button" class="secondary" (click)="closeDetail()">Close</button></div>
          @if (detailState() === 'loading') {
            <p role="status">Loading event provenance…</p>
          } @else if (detailState() === 'error') {
            <p role="alert">{{ detailError() }}</p>
          } @else if (detail()) {
            <dl>
              <div><dt>Date</dt><dd>{{ formatDate(detail()!.eventDate) }}</dd></div>
              <div><dt>Distance</dt><dd>{{ detail()!.distanceM }} m</dd></div>
              <div><dt>Time</dt><dd>{{ formatDuration(detail()!.durationS) }}</dd></div>
              <div><dt>Markers</dt><dd>{{ markers(detail()!) }}</dd></div>
              <div><dt>Source</dt><dd>{{ detail()!.source }}</dd></div>
              @if(detail()!.activityId){<div><dt>Linked run</dt><dd><a [routerLink]="['/activity',detail()!.activityId]">Open canonical activity</a></dd></div>}
              @if(detail()!.reconciliation; as match){<div><dt>Workout reconciliation</dt><dd>{{match.status}} · {{match.method}} · v{{match.policyVersion}} · {{match.reason}}</dd></div>}
              <div><dt>Provenance</dt><dd>{{ detail()!.provenance.status }}</dd></div>
              <div><dt>Source record</dt><dd>{{ detail()!.provenance.sourceRecordId ?? 'Not available' }}</dd></div>
              <div><dt>Import batch</dt><dd>{{ detail()!.provenance.importBatchId ?? 'Not available' }}</dd></div>
              <div><dt>Workbook row</dt><dd>{{ workbookRow(detail()!) }}</dd></div>
            </dl>
          }
        </section>
      }
  `,
  styles: [`
    .detail-heading { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
    dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    dl div { padding: 10px; background: var(--accent-surface); border-radius: 10px; min-width: 0; }
    dt { color: var(--text-muted); font-size: 12px; } dd { margin: 4px 0 0; overflow-wrap: anywhere; }
  `],
})
export class RunLabComponent implements OnDestroy {
  readonly detailState = signal<DetailState>('idle');
  readonly detail = signal<PerformanceEventDetail | null>(null);
  readonly detailError = signal<string | null>(null);
  private detailSubscription?: Subscription;
  constructor(private readonly api: PerformanceApiService) {}
  ngOnDestroy(): void { this.detailSubscription?.unsubscribe(); }
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

  formatDate(value: string | null | undefined): string {
    return formatDate(value);
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
