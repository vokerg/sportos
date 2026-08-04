import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CredentialCipher, parseCredentialKeyRing } from './credential-cipher.js';

const authorization = {
  providerAccountId: 'athlete-42',
  displayName: 'Test Athlete',
  accessToken: 'access-secret',
  refreshToken: 'refresh-secret',
  expiresAt: new Date('2026-08-04T12:00:00.000Z'),
  scopes: ['activity:read_all', 'read'],
};

describe('CredentialCipher', () => {
  it('round-trips credentials without storing plaintext', () => {
    const keys = `k1:${randomBytes(32).toString('base64')}`;
    const cipher = new CredentialCipher(parseCredentialKeyRing(keys, 'k1'));
    const envelope = cipher.encrypt('connection-1', 'owner-1', 'strava', authorization);

    expect(envelope.ciphertext).not.toContain('access-secret');
    expect(cipher.decrypt('connection-1', 'owner-1', 'strava', envelope)).toEqual(authorization);
  });

  it('rejects copied ciphertext through authenticated owner and connection context', () => {
    const keys = `k1:${randomBytes(32).toString('base64')}`;
    const cipher = new CredentialCipher(parseCredentialKeyRing(keys, 'k1'));
    const envelope = cipher.encrypt('connection-1', 'owner-1', 'strava', authorization);

    expect(() => cipher.decrypt('connection-2', 'owner-1', 'strava', envelope)).toThrow(/authentication failed/i);
    expect(() => cipher.decrypt('connection-1', 'owner-2', 'strava', envelope)).toThrow(/authentication failed/i);
  });

  it('decrypts old envelopes while encrypting with the active rotation key', () => {
    const first = randomBytes(32).toString('base64');
    const second = randomBytes(32).toString('base64');
    const oldCipher = new CredentialCipher(parseCredentialKeyRing(`old:${first},new:${second}`, 'old'));
    const envelope = oldCipher.encrypt('connection-1', 'owner-1', 'strava', authorization);
    const rotatedCipher = new CredentialCipher(parseCredentialKeyRing(`old:${first},new:${second}`, 'new'));

    expect(rotatedCipher.decrypt('connection-1', 'owner-1', 'strava', envelope)).toEqual(authorization);
    expect(rotatedCipher.encrypt('connection-1', 'owner-1', 'strava', authorization).keyId).toBe('new');
  });
});
