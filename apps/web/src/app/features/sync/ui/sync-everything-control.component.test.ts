// @vitest-environment jsdom
import '@angular/compiler';
import 'zone.js';
import 'zone.js/testing';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { signal } from '@angular/core';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { SyncEverythingStore } from '../state/sync-everything.store';
import { SyncEverythingControlComponent } from './sync-everything-control.component';
beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
afterEach(() => TestBed.resetTestingModule());
it('renders one prominent action and reports completion only after workflow success', async () => {
  const store = { busy: signal(false), view: signal({ status: 'idle', message: 'Strava → Garmin → Recalculate' }), label: () => 'Update everything', start: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true) };
  TestBed.configureTestingModule({ imports: [SyncEverythingControlComponent] });
  TestBed.overrideComponent(SyncEverythingControlComponent, { set: { providers: [{ provide: SyncEverythingStore, useValue: store }] } });
  const fixture = TestBed.createComponent(SyncEverythingControlComponent);
  fixture.detectChanges();
  const updated = vi.fn(); fixture.componentInstance.updated.subscribe(updated);
  const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
  expect(fixture.nativeElement.querySelectorAll('button')).toHaveLength(1);
  expect(button.textContent).toContain('Update everything');
  await fixture.componentInstance.start(); expect(updated).not.toHaveBeenCalled();
  await fixture.componentInstance.start(); expect(updated).toHaveBeenCalledOnce();
  store.busy.set(true); fixture.detectChanges(); expect(button.disabled).toBe(true);
});
