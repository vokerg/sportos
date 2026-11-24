// @vitest-environment jsdom
import '@angular/compiler';
import 'zone.js';
import 'zone.js/testing';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { PersonalRecordsApiService } from '../data-access/personal-records-api.service';
import type { PersonalRecordsResponse } from '../model/personal-records.models';
import { PersonalRecordsPageComponent } from './personal-records-page.component';

beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
afterEach(() => TestBed.resetTestingModule());

it('shows sport cards, daily and year records, and labels just the missing days', () => {
  const date = '2025-05-12';
  const swim = { targetDistanceM: 1000, distanceM: 1005, durationS: 1234, date, activityId: 'swim-id' };
  const daily = { metric: 'score', period: 'all', date, windowDays: 1, value: 4200, recordedDays: 1 } as const;
  const response: PersonalRecordsResponse = {
    through: date,
    running: [{ targetDistanceM: 5000, durationS: 1300, date, activityId: null, source: 'excel' }],
    cycling: [],
    swimming: [swim],
    daily: [daily, { ...daily, date, windowDays: 7, value: 840, recordedDays: 6 },
      { ...daily, date, windowDays: 20, value: 610, recordedDays: 20 },
      { ...daily, period: '2025', value: 2100 }],
  };
  TestBed.configureTestingModule({
    imports: [PersonalRecordsPageComponent],
    providers: [provideRouter([]), { provide: PersonalRecordsApiService, useValue: { read: () => of(response) } }],
  });
  const fixture = TestBed.createComponent(PersonalRecordsPageComponent);
  fixture.detectChanges();
  const page = fixture.nativeElement as HTMLElement;
  const choose = (label: string) => {
    [...page.querySelectorAll('nav button')].find(button => button.textContent?.trim() === label)?.dispatchEvent(new MouseEvent('click'));
    fixture.detectChanges();
  };

  expect(page.querySelector('.record')?.textContent).toContain('Historical Excel record');
  choose('Swimming');
  expect(page.querySelector('.record strong')?.textContent).toBe('20:34');
  expect(page.querySelector('.record a')?.getAttribute('href')).toBe('/activity/swim-id');
  choose('Cycling');
  expect(page.textContent).toContain('No qualifying cycling records');
  choose('Daily & rolling');
  expect(page.querySelectorAll('.record')).toHaveLength(3);
  expect(page.querySelector('.record a')?.getAttribute('href')).toBe('/daily/' + date);
  expect(page.textContent).toContain('1 missing day in this window');
  expect(page.textContent).not.toContain('20/20');
  const period = page.querySelectorAll('select')[1]!;
  period.value = '2025';
  period.dispatchEvent(new Event('change'));
  fixture.detectChanges();
  expect(page.querySelectorAll('.record')).toHaveLength(1);
  expect(page.querySelector('.record strong')?.textContent).toBe('2,100 pts');
});
