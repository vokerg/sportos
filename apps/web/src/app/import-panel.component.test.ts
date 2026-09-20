import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import type { ImportsStore } from './features/imports/state/imports.store';
import { ImportPanelComponent } from './import-panel.component';

describe('ImportPanelComponent', () => {
  it('forwards upload intent to feature state and clears the browser file input when accepted', () => {
    const store = { startImport: vi.fn().mockReturnValue(true) };
    const component = new ImportPanelComponent(store as unknown as ImportsStore);
    const fileInput = { value: 'selected' } as HTMLInputElement;

    component.startImport(fileInput);

    expect(store.startImport).toHaveBeenCalledOnce();
    expect(fileInput.value).toBe('');
  });

  it('keeps the browser file selection when state rejects the upload intent', () => {
    const store = { startImport: vi.fn().mockReturnValue(false) };
    const component = new ImportPanelComponent(store as unknown as ImportsStore);
    const fileInput = { value: 'selected' } as HTMLInputElement;

    component.startImport(fileInput);

    expect(fileInput.value).toBe('selected');
  });

  it('emits an affected date for Daily Log reconciliation', () => {
    const component = new ImportPanelComponent({} as ImportsStore);
    const listener = vi.fn();
    component.reconcileDate.subscribe(listener);

    component.openReconciliation('2026-05-18');

    expect(listener).toHaveBeenCalledWith('2026-05-18');
  });
});
