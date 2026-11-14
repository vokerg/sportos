// @vitest-environment jsdom
import '@angular/compiler';
import 'zone.js';
import 'zone.js/testing';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { of } from 'rxjs';
import { afterEach, beforeAll, expect, it } from 'vitest';
import type { GarminFetchJob } from '../../../shared/model/garmin-job';
import { GarminSyncStore } from '../state/garmin-sync.store';
import { GarminSyncControlComponent } from './garmin-sync-control.component';

beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
afterEach(() => TestBed.resetTestingModule());

it('shows activity before the first day completes and counts saved days as they finish', () => {
  TestBed.overrideComponent(GarminSyncControlComponent, {
    set: {
      providers: [{
        provide: GarminSyncStore,
        useFactory: () => new GarminSyncStore({
          connection: () => of({ enabled: true, activeJob: null }),
        } as never),
      }],
    },
  });
  const fixture = TestBed.createComponent(GarminSyncControlComponent);
  const control = fixture.componentInstance;
  const root = fixture.nativeElement as HTMLElement;
  const running: GarminFetchJob = {
    id: 'sync', operation: 'sync', date: null, activityId: null, refresh: true,
    status: 'running', phase: 'fetching', attemptCount: 1, errorCode: null,
    processedDays: 0, totalDays: 2,
  };

  fixture.detectChanges();
  control.store.job.set(running);
  fixture.detectChanges();
  expect(root.querySelector('progress')?.position).toBe(-1);
  expect(root.textContent).toContain('Syncing Garmin');
  expect(root.querySelector('button')).toBeNull();

  control.store.job.set({ ...running, processedDays: 1 });
  fixture.detectChanges();
  expect(root.querySelector('progress')?.position).toBe(0.5);
  expect(root.textContent).toContain('1 of 2 days');

  control.store.job.set({ ...running, status: 'succeeded', processedDays: 2 });
  fixture.detectChanges();
  expect(root.querySelector('progress')).toBeNull();
  expect(root.textContent).toContain('Garmin sync complete');
});
