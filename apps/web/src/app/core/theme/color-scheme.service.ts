import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';

/** CSS owns page colors; this signal adapts canvas charts to the same preference. */
@Injectable({ providedIn: 'root' })
export class ColorSchemeService {
  private readonly preference = inject(DOCUMENT).defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
  private readonly isDark = signal(this.preference?.matches ?? false);
  readonly dark = this.isDark.asReadonly();
  readonly chartTheme = computed(() => {
    const dark = this.dark();
    const text = dark ? '#c5cfdf' : '#475467';
    const border = dark ? '#435168' : '#d0d5dd';
    const axis = {
      axisLine: { lineStyle: { color: border } },
      axisTick: { lineStyle: { color: border } },
      axisLabel: { color: text },
      nameTextStyle: { color: text },
      splitLine: { lineStyle: { color: dark ? '#334155' : '#edf0f5' } },
    };
    return {
      backgroundColor: 'transparent',
      textStyle: { color: text },
      title: { textStyle: { color: text } },
      legend: { textStyle: { color: text }, inactiveColor: dark ? '#78869b' : '#767676' },
      categoryAxis: axis,
      valueAxis: axis,
      timeAxis: axis,
      tooltip: {
        backgroundColor: dark ? '#222e3e' : '#ffffff',
        borderColor: border,
        textStyle: { color: text },
      },
      dataZoom: {
        backgroundColor: dark ? '#182230' : '#f2f4f7',
        borderColor: border,
        textStyle: { color: text },
        dataBackground: { lineStyle: { color: text }, areaStyle: { color: border } },
      },
    };
  });

  constructor() {
    const update = (event: MediaQueryListEvent) => this.isDark.set(event.matches);
    this.preference?.addEventListener('change', update);
    inject(DestroyRef).onDestroy(() => this.preference?.removeEventListener('change', update));
  }
}
