import { InjectionToken, type Provider } from '@angular/core';
import { API_BASE_VALUE } from './api-base.value';

export const DEFAULT_SPORTOS_API_BASE = 'http://localhost:3010';

export const SPORTOS_API_BASE = new InjectionToken<string>('SPORTOS_API_BASE');

export const SPORTOS_API_BASE_PROVIDER: Provider = {
  provide: SPORTOS_API_BASE,
  useValue: API_BASE_VALUE,
};
