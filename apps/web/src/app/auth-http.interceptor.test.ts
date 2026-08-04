import { describe, expect, it } from 'vitest';
import { isSportosApiRequest } from './sportos-api-origin.js';

describe('isSportosApiRequest', () => {
  it('accepts the configured SportOS API origin', () => {
    expect(isSportosApiRequest(
      'http://localhost:3000/imports/upload',
      'http://localhost:4200',
      'http://localhost:3000',
    )).toBe(true);
  });

  it('rejects external and lookalike origins', () => {
    expect(isSportosApiRequest(
      'https://provider.example.com/oauth/token',
      'http://localhost:4200',
      'http://localhost:3000',
    )).toBe(false);
    expect(isSportosApiRequest(
      'http://localhost:3000.evil.example/imports/upload',
      'http://localhost:4200',
      'http://localhost:3000',
    )).toBe(false);
  });

  it('fails closed for malformed URLs', () => {
    expect(isSportosApiRequest(
      'http://[malformed',
      'http://localhost:4200',
      'http://localhost:3000',
    )).toBe(false);
  });
});
