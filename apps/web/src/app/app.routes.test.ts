import { describe, expect, it } from 'vitest';
import { APP_ROUTES } from './app.routes';

describe('APP_ROUTES', () => {
  it('keeps every major workflow and the complete daily deep link addressable', () => {
    expect(APP_ROUTES.map((route) => route.path)).toEqual([
      'overview', 'daily', 'daily/:date', 'run-lab', 'analysis', 'rules', 'providers', 'imports', 'export', '', '**',
    ]);
    expect(APP_ROUTES.filter((route) => route.path && route.path !== '**').every((route) => route.loadComponent)).toBe(true);
  });
});
