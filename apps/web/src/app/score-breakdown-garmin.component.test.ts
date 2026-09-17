import '@angular/compiler';
import { EnvironmentInjector, Injector, createEnvironmentInjector, runInInjectionContext } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { ScoreBreakdownGarminComponent } from './score-breakdown-garmin.component';
import type { GarminObservation } from './score-breakdown.models';

const sourceRecord = {
  id: '10000000-0000-4000-8000-000000000001',
  rowHash: 'row-hash',
  sheetName: 'weight_body_composition',
  rowIndex: 4,
  status: 'normalized' as const,
  rawJson: { cells: ['07:15', '82.4 kg'] },
  errors: [],
  warnings: [],
  normalizedEntityType: 'garmin_observation',
  normalizedEntityId: '20000000-0000-4000-8000-000000000001',
  batch: {
    id: '30000000-0000-4000-8000-000000000001',
    source: 'garmin_csv',
    filename: 'weight.csv',
    originalSha256: 'hash',
    status: 'normalized' as const,
    startedAt: '2026-09-11T08:00:00.000Z',
    completedAt: '2026-09-11T08:00:01.000Z',
  },
};

describe('ScoreBreakdownGarminComponent', () => {
  it('presents an exact daily summary without a weekly qualifier', () => {
    const { component, injector } = createComponent();
    const observation: GarminObservation = {
      id: '20000000-0000-4000-8000-000000000000',
      reportType: 'daily_summary',
      recordedDate: '2026-09-11',
      recordedTime: null,
      values: { steps: 5056, distanceKm: 4.2, totalCalories: 2808 },
      sourceRecord: { ...sourceRecord, sheetName: 'daily_summary' },
    };

    expect(component.reportLabel(observation)).toBe('Daily summary');
    expect(component.dateLabel(observation)).not.toContain('Week ending');
    expect(component.metrics(observation)).toEqual([
      { label: 'Steps', value: '5,056' },
      { label: 'Distance', value: '4.2 km' },
      { label: 'Total calories', value: '2,808' },
    ]);
    injector.destroy();
  });

  it('presents a dated weight measurement with readable units', () => {
    const { component, injector } = createComponent();
    const observation: GarminObservation = {
      id: '20000000-0000-4000-8000-000000000001',
      reportType: 'weight_body_composition',
      recordedDate: '2026-09-11',
      recordedTime: '07:15:00',
      values: { weightKg: 82.4, bodyFatPercent: 18.2, bodyWaterPercent: null },
      sourceRecord,
    };

    expect(component.reportLabel(observation)).toBe('Weight and body composition');
    expect(component.dateLabel(observation)).toContain('07:15');
    expect(component.metrics(observation)).toEqual([
      { label: 'Weight', value: '82.4 kg' },
      { label: 'Body fat', value: '18.2%' },
    ]);
    injector.destroy();
  });

  it('labels weekly observations by their week-ending date', () => {
    const { component, injector } = createComponent();
    const observation: GarminObservation = {
      id: '20000000-0000-4000-8000-000000000002',
      reportType: 'steps_weekly',
      recordedDate: '2026-09-11',
      recordedTime: null,
      values: { steps: 12345 },
      sourceRecord: { ...sourceRecord, sheetName: 'steps_weekly' },
    };

    expect(component.dateLabel(observation)).toContain('Week ending');
    expect(component.metrics(observation)).toEqual([{ label: 'Steps', value: '12,345' }]);
    injector.destroy();
  });
});

function createComponent() {
  const injector = createEnvironmentInjector([], Injector.NULL as unknown as EnvironmentInjector);
  return {
    injector,
    component: runInInjectionContext(injector, () => new ScoreBreakdownGarminComponent()),
  };
}
