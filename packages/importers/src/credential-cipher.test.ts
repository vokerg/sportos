import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CredentialCipher, parseCredentialKeyRing } from './credential-cipher.js';

const authorization = {
  providerAccountId: 'athlete-42', displayName: 'Test Athlete', accessToken: 'access-secret', refreshToken: 'refresh-secret',
  expiresAt: new Date('2026-08-04T12:00:00.000Z'), scopes: ['activity:read_all', 'read'],
};

describe('CredentialCipher', () => {
  it('round-trips without plaintext and binds owner/connection context', () => {
    const cipher = new CredentialCipher(parseCredentialKeyRing(`k1:${randomBytes(32).toString('base64')}`, 'k1'));
    const envelope = cipher.encrypt('connection-1', 'owner-1', 'strava', authorization);
    expect(envelope.ciphertext).not.toContain('access-secret');
    expect(cipher.decrypt('connection-1', 'owner-1', 'strava', envelope)).toEqual(authorization);
    expect(() => cipher.decrypt('connection-2', 'owner-1', 'strava', envelope)).toThrow(/authentication failed/i);
  });

  it('supports key rotation', () => {
    const oldKey = randomBytes(32).toString('base64');
    const newKey = randomBytes(32).toString('base64');
    const oldCipher = new CredentialCipher(parseCredentialKeyRing(`old:${oldKey},new:${newKey}`, 'old'));
    const envelope = oldCipher.encrypt('connection-1', 'owner-1', 'strava', authorization);
    const newCipher = new CredentialCipher(parseCredentialKeyRing(`old:${oldKey},new:${newKey}`, 'new'));
    expect(newCipher.decrypt('connection-1', 'owner-1', 'strava', envelope)).toEqual(authorization);
    expect(newCipher.encrypt('connection-1', 'owner-1', 'strava', authorization).keyId).toBe('new');
  });
});
