import '@angular/compiler';
import { of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { PerformanceApiService } from './features/performance/data-access/performance-api.service';
import type { PerformanceEventDetail, PerformanceEventRow } from './features/performance/model/performance.models';
import { RunLabComponent } from './run-lab.component';

const row: PerformanceEventRow = {
  id: '11111111-1111-4111-8111-111111111111',
  activityId: null,
  eventDate: '2026-05-18',
  source: 'run_db_xlsx',
  distanceM: 5000,
  durationS: 1500,
  paceSPerKm: 300,
  isTreadmill: false,
  isRace: true,
  isPrMarker: true,
  isPrByTime: true,
  sourceRank: 1,
  allTimeRank: 1,
  tags: ['race'],
  notes: null,
};

const detail: PerformanceEventDetail = {
  ...row,
  provenance: {
    status: 'available',
    sourceRecordId: '22222222-2222-4222-8222-222222222222',
    sourceRecordHash: 'row-hash',
    importBatchId: '33333333-3333-4333-8333-333333333333',
    source: 'run-db',
    sheetName: '5K',
    rowIndex: 2,
    filename: 'run-db.xlsx',
  },
};

describe('RunLabComponent', () => {
  it('does not request the removed history list', () => {
    const api = { performanceEvents: vi.fn(), performanceEvent: vi.fn() };
    const component = new RunLabComponent(api as unknown as PerformanceApiService);
    expect(component.detailState()).toBe('idle');
    expect(api.performanceEvents).not.toHaveBeenCalled();
  });

  it('loads event detail and exposes source provenance', () => {
    const api = { performanceEvents: vi.fn().mockReturnValue(of([])), performanceEvent: vi.fn().mockReturnValue(of(detail)) };
    const component = new RunLabComponent(api as unknown as PerformanceApiService);
    component.openEvent(row.id);
    expect(component.detailState()).toBe('loaded');
    expect(component.detail()?.provenance.importBatchId).toBe(detail.provenance.importBatchId);
    expect(component.workbookRow(detail)).toContain('run-db.xlsx / 5K / row 2');
    expect(component.markers(row)).toBe('Race, PR');
  });

  it('cancels source inspection on close, replacement and teardown',()=>{const a=new Subject<PerformanceEventDetail>(),b=new Subject<PerformanceEventDetail>();const component=new RunLabComponent({performanceEvent:vi.fn().mockReturnValueOnce(a).mockReturnValueOnce(b)} as unknown as PerformanceApiService);component.openEvent('a');component.openEvent('b');expect(a.observed).toBe(false);component.closeDetail();expect(b.observed).toBe(false);expect(component.detailState()).toBe('idle');component.ngOnDestroy();});

  it('formats duration and pace for non-developer review', () => {
    const component = new RunLabComponent({} as PerformanceApiService);
    expect(component.formatDuration(1500)).toBe('25:00');
    expect(component.formatDuration(3661)).toBe('1:01:01');
  });
});
