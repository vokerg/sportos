import '@angular/compiler';
import {
  EnvironmentInjector,
  Injector,
  createEnvironmentInjector,
  runInInjectionContext,
} from '@angular/core';
import { describe, expect, it } from 'vitest';
import { ScoreBreakdownManualFactsComponent } from './score-breakdown-manual-facts.component';
import type { DailyScoreBreakdown } from './score-breakdown.models';

const breakdown: DailyScoreBreakdown = {
  date: '2026-05-18',
  recomputedAt: '2026-05-18T12:00:00.000Z',
  scoreStatus: 'manual',
  facts: {
    steps: 12_345,
    runM: 8_500,
    runIndoorM: 2_500,
    runOutdoorM: 5_000,
    runUnspecifiedM: 1_000,
    bikeM: 21_250,
    bikeIndoorM: 10_000,
    bikeOutdoorM: 8_250,
    bikeUnspecifiedM: 3_000,
    swimM: 750,
    workoutPoints: 12,
    powerPoints: 4,
  },
  score: { appTotal: 25, excelTotal: null, delta: null, baseTotal: 20, bonusTotal: 5, ledgerTotal: 25 },
  sourceRecord: null,
  activities: [],
  sourceRecords: [],
  ledger: [],
};

describe('ScoreBreakdownManualFactsComponent', () => {
  it('prefills manual editing from current canonical facts', () => {
    const { component, injector } = createComponent();

    component.startManualEdit(breakdown);

    expect({
      steps: component.manualSteps(),
      runIndoorKm: component.manualRunIndoorKm(),
      runOutdoorKm: component.manualRunOutdoorKm(),
      runUnspecifiedKm: component.manualRunUnspecifiedKm(),
      bikeIndoorKm: component.manualBikeIndoorKm(),
      bikeOutdoorKm: component.manualBikeOutdoorKm(),
      bikeUnspecifiedKm: component.manualBikeUnspecifiedKm(),
      swimM: component.manualSwimM(),
      workoutPoints: component.manualWorkoutPoints(),
      powerPoints: component.manualPowerPoints(),
    }).toEqual({
      steps: 12_345,
      runIndoorKm: 2.5,
      runOutdoorKm: 5,
      runUnspecifiedKm: 1,
      bikeIndoorKm: 10,
      bikeOutdoorKm: 8.25,
      bikeUnspecifiedKm: 3,
      swimM: 750,
      workoutPoints: 12,
      powerPoints: 4,
    });
    expect(component.editing()).toBe(true);

    injector.destroy();
  });

  it('emits split distances without inventing authoritative totals', () => {
    const { component, injector } = createComponent();
    const emitted: unknown[] = [];
    component.save.subscribe((value) => emitted.push(value));
    component.startManualEdit(null);
    component.manualRunIndoorKm.set(4);
    component.manualRunOutdoorKm.set(2);
    component.manualRunUnspecifiedKm.set(1);
    component.manualBikeIndoorKm.set(10);
    component.manualBikeOutdoorKm.set(2);
    component.manualBikeUnspecifiedKm.set(1);

    component.submitManualFacts();

    expect(component.validationError()).toBeNull();
    expect(emitted).toEqual([expect.objectContaining({
      runIndoorM: 4000,
      runOutdoorM: 2000,
      runUnspecifiedM: 1000,
      bikeIndoorM: 10000,
      bikeOutdoorM: 2000,
      bikeUnspecifiedM: 1000,
    })]);
    expect(emitted[0]).not.toHaveProperty('runM');
    expect(emitted[0]).not.toHaveProperty('bikeM');

    injector.destroy();
  });

  it('treats cleared optional numeric inputs as zero', () => {
    const { component, injector } = createComponent();
    const emitted: unknown[] = [];
    component.save.subscribe((value) => emitted.push(value));
    component.startManualEdit(null);

    component.manualSteps.set(component.numberInputValue(numberInputEvent('5056', 5056)));
    component.manualSwimM.set(component.numberInputValue(numberInputEvent('', Number.NaN)));
    component.submitManualFacts();

    expect(component.validationError()).toBeNull();
    expect(emitted).toEqual([{
      steps: 5056,
      runIndoorM: 0,
      runOutdoorM: 0,
      runUnspecifiedM: 0,
      bikeIndoorM: 0,
      bikeOutdoorM: 0,
      bikeUnspecifiedM: 0,
      swimM: 0,
      workoutPoints: 0,
      powerPoints: 0,
    }]);

    injector.destroy();
  });

  it('rejects negative and fractional whole-number fields before emitting', () => {
    const { component, injector } = createComponent();
    const emitted: unknown[] = [];
    component.save.subscribe((value) => emitted.push(value));
    component.startManualEdit(null);

    component.manualRunOutdoorKm.set(-1);
    component.submitManualFacts();
    expect(component.validationError()).toContain('non-negative');
    expect(emitted).toEqual([]);

    component.manualRunOutdoorKm.set(0);
    component.manualSteps.set(1.5);
    component.submitManualFacts();
    expect(component.validationError()).toContain('whole numbers');
    expect(emitted).toEqual([]);

    injector.destroy();
  });
});

function numberInputEvent(value: string, valueAsNumber: number): Event {
  return { target: { value, valueAsNumber } } as unknown as Event;
}

function createComponent(): { component: ScoreBreakdownManualFactsComponent; injector: EnvironmentInjector } {
  const injector = createEnvironmentInjector([], Injector.NULL as unknown as EnvironmentInjector);
  const component = runInInjectionContext(injector, () => new ScoreBreakdownManualFactsComponent());
  return { component, injector };
}
