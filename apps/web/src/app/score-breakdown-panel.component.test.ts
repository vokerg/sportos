import '@angular/compiler';
import {
  EnvironmentInjector,
  Injector,
  createEnvironmentInjector,
  runInInjectionContext,
} from '@angular/core';
import { describe, expect, it } from 'vitest';
import { ScoreBreakdownPanelComponent } from './score-breakdown-panel.component';

describe('ScoreBreakdownPanelComponent', () => {
  it('defaults to the accessible idle composition state', () => {
    const { component, injector } = createComponent();

    expect(component.state()).toBe('idle');
    expect(component.date()).toBeNull();
    expect(component.breakdown()).toBeNull();
    expect(component.errorMessage()).toBeNull();
    expect(component.recalculating()).toBe(false);
    expect(component.recalculationError()).toBeNull();
    expect(component.savingManual()).toBe(false);
    expect(component.manualSaveError()).toBeNull();

    injector.destroy();
  });

  it('turns local edit intents into monotonic child edit requests', () => {
    const { component, injector } = createComponent();

    expect(component.localManualEditRequestId()).toBe(0);
    component.requestManualEdit();
    component.requestManualEdit();

    expect(component.localManualEditRequestId()).toBe(2);

    injector.destroy();
  });

  it('exposes top-level workflow intents without owning API orchestration', () => {
    const { component, injector } = createComponent();
    const intents: string[] = [];

    component.retry.subscribe(() => intents.push('retry'));
    component.recalculate.subscribe(() => intents.push('recalculate'));
    component.closed.subscribe(() => intents.push('closed'));

    component.retry.emit();
    component.recalculate.emit();
    component.closed.emit();

    expect(intents).toEqual(['retry', 'recalculate', 'closed']);

    injector.destroy();
  });
});

function createComponent(): { component: ScoreBreakdownPanelComponent; injector: EnvironmentInjector } {
  const injector = createEnvironmentInjector([], Injector.NULL as unknown as EnvironmentInjector);
  const component = runInInjectionContext(injector, () => new ScoreBreakdownPanelComponent());
  return { component, injector };
}
