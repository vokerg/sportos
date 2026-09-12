import '@angular/compiler';
import type { Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { ImportsPageComponent } from './imports-page.component';

describe('ImportsPageComponent', () => {
  it('hands reconciliation dates to the complete daily route', () => {
    const router = { navigate: vi.fn().mockResolvedValue(true) };
    const component = new ImportsPageComponent(router as unknown as Router);

    component.openDay('2026-09-11');

    expect(router.navigate).toHaveBeenCalledWith(['/daily', '2026-09-11']);
  });
});
