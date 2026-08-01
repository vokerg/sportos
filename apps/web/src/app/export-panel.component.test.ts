import '@angular/compiler';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiService, CanonicalExportBundle } from './api.service';
import { ExportPanelComponent } from './export-panel.component';

const bundle: CanonicalExportBundle = {
  schemaVersion: 'sportos.canonical-export.v1',
  generatedAt: '2026-08-01T00:00:00.000Z',
  dateRange: { from: '2026-05-01', to: '2026-05-31' },
  rowCounts: { dailySummaries: 1, activities: 2, performanceEvents: 3 },
  dailySummaries: [],
  activities: [],
  performanceEvents: [],
};

describe('ExportPanelComponent', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rejects an invalid range without requesting an export', () => {
    const api = { canonicalExport: vi.fn() };
    const component = new ExportPanelComponent(api as unknown as ApiService);
    component.from.set('2026-06-01');
    component.to.set('2026-05-01');
    component.export();
    expect(component.state()).toBe('error');
    expect(api.canonicalExport).not.toHaveBeenCalled();
  });

  it('downloads the validated JSON and exposes exact row counts', () => {
    const click = vi.fn();
    const createObjectURL = vi.fn().mockReturnValue('blob:export');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('document', { createElement: vi.fn().mockReturnValue({ href: '', download: '', click }) });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const api = { canonicalExport: vi.fn().mockReturnValue(of(bundle)) };
    const component = new ExportPanelComponent(api as unknown as ApiService);
    component.from.set(bundle.dateRange.from);
    component.to.set(bundle.dateRange.to);

    component.export();

    expect(component.state()).toBe('ready');
    expect(component.lastBundle()?.rowCounts).toEqual(bundle.rowCounts);
    expect(api.canonicalExport).toHaveBeenCalledWith(bundle.dateRange.from, bundle.dateRange.to);
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:export');
  });

  it('serializes a stable UTF-8 JSON document with a trailing newline', () => {
    const component = new ExportPanelComponent({} as ApiService);
    const serialized = component.serialize(bundle);
    expect(JSON.parse(serialized)).toEqual(bundle);
    expect(serialized.endsWith('\n')).toBe(true);
  });
});
