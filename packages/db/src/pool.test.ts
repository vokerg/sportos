import { describe, expect, it } from 'vitest';
import { requiredActivityDetailDatabaseUrl } from './pool.js';

describe('requiredActivityDetailDatabaseUrl', () => {
  it('accepts an explicit PostgreSQL URL', () => {
    const value = 'postgresql://sportos_app:secret@detail.neon.tech/sportos_activity_detail?sslmode=require';
    expect(requiredActivityDetailDatabaseUrl(value)).toBe(value);
  });

  it('rejects missing and non-PostgreSQL URLs', () => {
    expect(() => requiredActivityDetailDatabaseUrl(undefined)).toThrow(/separate activity-detail project/);
    expect(() => requiredActivityDetailDatabaseUrl('https://example.com')).toThrow(/must use PostgreSQL/);
  });
});
