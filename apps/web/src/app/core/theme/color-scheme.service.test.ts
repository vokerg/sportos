import '@angular/compiler';
import { DOCUMENT } from '@angular/common';
import { EnvironmentInjector, Injector, createEnvironmentInjector } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { ColorSchemeService } from './color-scheme.service';

function setup(matches: boolean, supported = true) {
  const preference = { matches, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const matchMedia = vi.fn().mockReturnValue(preference);
  const injector = createEnvironmentInjector([
    ColorSchemeService,
    { provide: DOCUMENT, useValue: { defaultView: supported ? { matchMedia } : null } },
  ], Injector.NULL as EnvironmentInjector);
  return { injector, preference, matchMedia, service: injector.get(ColorSchemeService) };
}

describe('browser color preference', () => {
  it.each([false, true])('uses the initial browser preference (dark: %s)', matches => {
    const { injector, service, matchMedia } = setup(matches);
    expect(matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
    expect(service.dark()).toBe(matches);
    expect(service.chartTheme().backgroundColor).toBe('transparent');
    expect(service.chartTheme().textStyle.color).toBe(matches ? '#c5cfdf' : '#475467');
    injector.destroy();
  });

  it('updates chart text, axes, tooltips and zoom in both directions and removes its listener', () => {
    const { injector, service, preference } = setup(false);
    const listener = preference.addEventListener.mock.calls[0]![1];
    const light = service.chartTheme();
    listener({ matches: true });
    const dark = service.chartTheme();
    expect(service.dark()).toBe(true);
    expect(dark.valueAxis.axisLabel.color).not.toBe(light.valueAxis.axisLabel.color);
    expect(dark.valueAxis.splitLine.lineStyle.color).not.toBe(light.valueAxis.splitLine.lineStyle.color);
    expect(dark.tooltip.backgroundColor).not.toBe(light.tooltip.backgroundColor);
    expect(dark.dataZoom.backgroundColor).not.toBe(light.dataZoom.backgroundColor);
    listener({ matches: false });
    expect(service.chartTheme()).toEqual(light);
    injector.destroy();
    expect(preference.removeEventListener).toHaveBeenCalledWith('change', listener);
  });

  it('falls back to light without a browser preference API', () => {
    const { injector, service } = setup(false, false);
    expect(service.dark()).toBe(false);
    injector.destroy();
  });
});
