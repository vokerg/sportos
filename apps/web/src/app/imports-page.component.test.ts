import '@angular/compiler';
import type { Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import type { ImportsStore } from './features/imports/state/imports.store';
import { ImportsPageComponent } from './imports-page.component';

describe('ImportsPageComponent', () => {
  it('initializes route-scoped import state', () => {
    const router = { navigate: vi.fn().mockResolvedValue(true) };
    const store = { initialize: vi.fn() };
    const component = new ImportsPageComponent(
      router as unknown as Router,
      store as unknown as ImportsStore,
    );

    component.ngOnInit();

    expect(store.initialize).toHaveBeenCalledOnce();
  });

  it('hands reconciliation dates to the complete daily route', () => {
    const router = { navigate: vi.fn().mockResolvedValue(true) };
    const component = new ImportsPageComponent(
      router as unknown as Router,
      { initialize: vi.fn() } as unknown as ImportsStore,
    );

    component.openDay('2026-09-11');

    expect(router.navigate).toHaveBeenCalledWith(['/daily', '2026-09-11']);
  });
});
