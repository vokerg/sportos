import { describe, expect, it } from 'vitest';
import { sportosCorsOptions } from './cors-options.js';

describe('SportOS CORS options', () => {
  it('allows the exact web origin and every supported API method', () => {
    const options = sportosCorsOptions('http://localhost:4210');

    expect(options.origin).toBe('http://localhost:4210');
    expect(options.credentials).toBe(true);
    expect(options.methods).toContain('PUT');
    expect(options.allowedHeaders).toContain('X-SportOS-CSRF');
  });
});
