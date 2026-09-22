import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it, vi } from 'vitest';
import type { ProviderStore } from './features/providers/state/provider.store';
import { ProviderPanelComponent, describeError } from './provider-panel.component';

describe('ProviderPanelComponent', () => {
  it('initializes route-scoped provider state', () => {
    const store = { initialize: vi.fn() };
    const component = new ProviderPanelComponent(store as unknown as ProviderStore);

    component.ngOnInit();

    expect(store.initialize).toHaveBeenCalledOnce();
  });

  it('keeps safe provider error formatting available through the compatibility export', () => {
    expect(describeError(new HttpErrorResponse({
      status: 503,
      error: { message: 'Provider service is unavailable.' },
    }), 'fallback')).toBe('Provider service is unavailable.');
    expect(describeError(new HttpErrorResponse({ status: 0 }), 'fallback')).toBe('The SportOS API is unavailable.');
    expect(describeError(new Error('secret details'), 'fallback')).toBe('fallback');
  });
});
