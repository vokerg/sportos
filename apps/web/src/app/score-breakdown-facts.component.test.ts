import '@angular/compiler';
import { EnvironmentInjector, Injector, createEnvironmentInjector, runInInjectionContext } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { ScoreBreakdownFactsComponent } from './score-breakdown-facts.component';
describe('Garmin score explanation',()=>{
  it('labels Connect/CSV/manual sources and explains the actual step deduction',()=>{
    const injector=createEnvironmentInjector([],Injector.NULL as EnvironmentInjector);
    try {
      const component=runInInjectionContext(injector,()=>new ScoreBreakdownFactsComponent());
      expect(component.stepsSource({source:'garmin_adjusted',resolvedSteps:6545,garminSource:'connect'})).toContain('Garmin Connect');
      expect(component.stepsSource({source:'garmin_adjusted',resolvedSteps:6545,garminSource:'csv'})).toContain('Garmin CSV');
      expect(component.garminEquation({source:'garmin_adjusted',garminTotalSteps:12345,estimatedRunningSteps:5800,resolvedSteps:6545})).toBe('Garmin 12,345 − running 5,800 = 6,545 steps');
      expect(component.workoutSource({source:'garmin_sets',resolvedPoints:2000,workingSets:6})).toBe('Garmin working sets');
      expect(component.workoutSource({source:'stored',resolvedPoints:2000,incompleteReason:'Incomplete discovery'})).toBe('Existing value preserved');
    } finally {injector.destroy();}
  });
});
