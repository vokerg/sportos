import '@angular/compiler';
import {
  EnvironmentInjector,
  Injector,
  createEnvironmentInjector,
  runInInjectionContext,
} from '@angular/core';
import { describe, expect, it } from 'vitest';
import { ScoreBreakdownActivitiesComponent } from './score-breakdown-activities.component';
import { ScoreBreakdownFactsComponent } from './score-breakdown-facts.component';
import { ScoreBreakdownLedgerComponent } from './score-breakdown-ledger.component';
import { ScoreBreakdownProvenanceComponent } from './score-breakdown-provenance.component';
import { ScoreBreakdownSourceSummaryComponent } from './score-breakdown-source-summary.component';
import { ScoreBreakdownSummaryComponent } from './score-breakdown-summary.component';

describe('score breakdown presentation components', () => {
  it('emits summary and canonical-facts user intents at the leaf boundary', () => {
    const injector = createEnvironmentInjector([], Injector.NULL as unknown as EnvironmentInjector);
    const { summary, facts } = runInInjectionContext(injector, () => ({
      summary: new ScoreBreakdownSummaryComponent(),
      facts: new ScoreBreakdownFactsComponent(),
    }));
    const intents: string[] = [];

    summary.recalculate.subscribe(() => intents.push('recalculate'));
    facts.edit.subscribe(() => intents.push('edit'));
    summary.recalculate.emit();
    facts.edit.emit();

    expect(intents).toEqual(['recalculate', 'edit']);
    injector.destroy();
  });

  it('constructs activity, provenance, and ledger leaves without API dependencies', () => {
    const injector = createEnvironmentInjector([], Injector.NULL as unknown as EnvironmentInjector);
    const leaves = runInInjectionContext(injector, () => [
      new ScoreBreakdownActivitiesComponent(),
      new ScoreBreakdownSourceSummaryComponent(),
      new ScoreBreakdownProvenanceComponent(),
      new ScoreBreakdownLedgerComponent(),
    ]);

    expect(leaves.map((component) => component.constructor.name)).toEqual([
      'ScoreBreakdownActivitiesComponent',
      'ScoreBreakdownSourceSummaryComponent',
      'ScoreBreakdownProvenanceComponent',
      'ScoreBreakdownLedgerComponent',
    ]);
    injector.destroy();
  });

  it('explains the Garmin total and each running-step estimate', () => {
    const injector = createEnvironmentInjector([], Injector.NULL as unknown as EnvironmentInjector);
    const facts = runInInjectionContext(injector, () => new ScoreBreakdownFactsComponent());
    const calculation = {
      source: 'garmin_adjusted' as const,
      resolvedSteps: 2_701,
      garminTotalSteps: 15_000,
      estimatedRunningSteps: 12_299,
    };

    expect(facts.garminEquation(calculation)).toBe('Garmin 15,000 − running 12,299 = 2,701 steps');
    expect(facts.runEquation({
      distanceM: 10_000,
      movingTimeS: 2_400,
      cadenceSpm: 186,
      cadenceSource: 'strava_cadence',
      estimatedSteps: 7_440,
    })).toContain('186 spm (Strava cadence)');
    injector.destroy();
  });
});
