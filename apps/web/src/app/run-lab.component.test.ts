import '@angular/compiler';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { ApiService, PerformanceEventDetail, PerformanceEventRow } from './api.service';
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
  it('loads filtered performance events and builds a chronological trend', () => {
    const api = { performanceEvents: vi.fn().mockReturnValue(of([row])), performanceEvent: vi.fn() };
    const component = new RunLabComponent(api as unknown as ApiService);
    component.ngOnInit();
    expect(component.state()).toBe('loaded');
    expect(component.rows()).toEqual([row]);
    expect(api.performanceEvents).toHaveBeenCalledWith({ distanceM: 5000, from: undefined, to: undefined, limit: 500 });
    expect(component.chartOptions()).toMatchObject({ series: [{ name: 'Duration' }] });
  });

  it('rejects reversed dates without calling the API', () => {
    const api = { performanceEvents: vi.fn().mockReturnValue(of([])), performanceEvent: vi.fn() };
    const component = new RunLabComponent(api as unknown as ApiService);
    component.from.set('2026-06-01');
    component.to.set('2026-05-01');
    component.applyFilters();
    expect(component.state()).toBe('error');
    expect(api.performanceEvents).not.toHaveBeenCalled();
  });

  it('loads event detail and exposes source provenance', () => {
    const api = { performanceEvents: vi.fn().mockReturnValue(of([])), performanceEvent: vi.fn().mockReturnValue(of(detail)) };
    const component = new RunLabComponent(api as unknown as ApiService);
    component.openEvent(row.id);
    expect(component.detailState()).toBe('loaded');
    expect(component.detail()?.provenance.importBatchId).toBe(detail.provenance.importBatchId);
    expect(component.workbookRow(detail)).toContain('run-db.xlsx / 5K / row 2');
    expect(component.markers(row)).toBe('Race, PR');
  });

  it('formats duration and pace for non-developer review', () => {
    const component = new RunLabComponent({} as ApiService);
    expect(component.formatDuration(1500)).toBe('25:00');
    expect(component.formatDuration(3661)).toBe('1:01:01');
    expect(component.formatPace(305)).toBe('5:05');
  });
});
