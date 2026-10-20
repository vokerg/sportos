// @vitest-environment jsdom
import '@angular/compiler';
import 'zone.js';
import 'zone.js/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { Subject, of } from 'rxjs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RulesPageComponent } from './rules-page.component';
import { RulesApiService } from '../data-access/rules-api.service';
import type { RuleVersion } from '../model/rules.models';

beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
afterEach(() => TestBed.resetTestingModule());
const rules: RuleVersion[] = [{
  id: 'swim', code: 'swim.1k.sub20.bonus', name: 'Swim under 20', activityType: 'swim',
  version: 4, supersedesRuleId: 'old', enabled: true, validFrom: '1900-01-01', priority: 90,
  createdAt: '2026-01-01', ruleKind: 'achievement', metric: 'moving_pace_s_per_km',
  achievementGroup: 'swim.pace.1k', pointsMultiplier: 'completed_1k_blocks',
  guide: { label: 'Faster than 20:00/km', award: '+2,000 per completed km',
    notes: ['Only the highest qualifying tier applies.'], example: '2 completed km × 2,000 tier points = 4,000 bonus points.' },
}];
function setup(response = of(rules)) {
  const api = { ruleVersions: vi.fn().mockReturnValue(response) };
  TestBed.configureTestingModule({ imports: [RulesPageComponent], providers: [provideRouter([]), { provide: RulesApiService, useValue: api }] });
  const fixture = TestBed.createComponent(RulesPageComponent);
  fixture.detectChanges();
  return { api, fixture, el: fixture.nativeElement as HTMLElement };
}

describe('read-only scoring guide page', () => {
  it('shows readable rules and examples, with history collapsed and no editing controls', () => {
    const { api, el } = setup();
    expect(api.ruleVersions).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain('How your score works');
    expect(el.textContent).toContain('Swimming');
    expect(el.textContent).toContain('Faster than 20:00/km');
    expect(el.textContent).toContain('+2,000 per completed km');
    expect(el.textContent).toContain('2 completed km × 2,000 tier points = 4,000');
    expect(el.querySelector('details')?.open).toBe(false);
    expect(el.querySelectorAll('input, select, textarea, form')).toHaveLength(0);
    expect([...el.querySelectorAll('button')].map(button => button.textContent?.trim())).toEqual(['Refresh rules']);
    expect(el.textContent).not.toContain('Supersede');
    expect(el.textContent).not.toContain('Activate');
  });
  it('shows loading and errors, then recovers through the manual read refresh', () => {
    const pending = new Subject<RuleVersion[]>();
    const { api, fixture, el } = setup(pending);
    expect(el.querySelector('[role=status]')?.textContent).toContain('Loading');
    pending.error(new Error('private error details'));
    fixture.detectChanges();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Could not load');
    expect(el.textContent).not.toContain('private error details');
    api.ruleVersions.mockReturnValue(of(rules));
    el.querySelector<HTMLButtonElement>('[role=alert] button')!.click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Swimming');
  });
  it('handles empty accounts and cancels reads on replacement and route teardown', () => {
    const { fixture, el } = setup(of([]));
    expect(el.textContent).toContain('No scoring rules are currently in effect');
    fixture.destroy();
    TestBed.resetTestingModule();
    const first = new Subject<RuleVersion[]>();
    const second = new Subject<RuleVersion[]>();
    const next = setup(first);
    expect(first.observed).toBe(true);
    next.api.ruleVersions.mockReturnValue(second);
    next.fixture.componentInstance.refresh();
    expect(first.observed).toBe(false);
    expect(second.observed).toBe(true);
    next.fixture.destroy();
    expect(second.observed).toBe(false);
  });
});
