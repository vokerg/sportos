import { describe, expect, it } from 'vitest';
import { databaseUrlForName } from './pool.js';

describe('databaseUrlForName', () => {
  it('preserves the Neon endpoint, credentials, and connection options', () => {
    expect(databaseUrlForName(
      'postgresql://sportos_app:secret@ep-example.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
      'sportos_activity_detail',
    )).toBe('postgresql://sportos_app:secret@ep-example.eu-central-1.aws.neon.tech/sportos_activity_detail?sslmode=require&channel_binding=require');
  });

  it('rejects unsafe database names', () => {
    expect(() => databaseUrlForName('postgresql://localhost/neondb', 'detail;drop')).toThrow(/simple PostgreSQL identifier/);
  });
});
