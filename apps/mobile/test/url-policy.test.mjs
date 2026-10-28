import assert from 'node:assert/strict';
import test from 'node:test';
import { isExactOrigin, validAuthorizationUrl } from '../src/auth/url-policy.mjs';

test('release origins must be HTTPS without paths, credentials or query parameters', () => {
  assert.equal(isExactOrigin('https://sportos.example.com'), true);
  assert.equal(isExactOrigin('https://sportos.example.com/'), true);
  for (const candidate of ['http://sportos.example.com', 'https://me@host.com',
    'https://sportos.example.com/login', 'https://sportos.example.com?a=1',
    'file:///tmp/x', '']) {
    assert.equal(isExactOrigin(candidate), false, candidate);
  }
  assert.equal(isExactOrigin('https://sportos.example.com.evil.test'), true); // valid syntax, but not the configured origin
  assert.equal(isExactOrigin('http://localhost:4210', true), true);
  assert.equal(isExactOrigin('http://192.168.1.1:4210', true), false);
});
test('browser authorization URL must match exact expected web origin and one request', () => {
  const web = 'https://sportos.example.com';
  assert.equal(validAuthorizationUrl(`${web}/mobile-connect?request=abc`, web), true);
  for (const candidate of [`${web}/login?request=abc`, `${web}/mobile-connect`,
    `${web}/mobile-connect?request=abc&request=def`,
    `${web}/mobile-connect?request=abc&next=https://other.com`,
    `${web}/mobile-connect?request=abc#fragment`,
    'https://sportos.example.com.evil.test/mobile-connect?request=abc',
    'http://sportos.example.com/mobile-connect?request=abc']) {
    assert.equal(validAuthorizationUrl(candidate, web), false, candidate);
  }
});

// Keychain must never reuse a local credential at a hosted API origin.
test('secure session keys are scoped to normalized deployment origins', async () => {
  const {sessionStorageKey} = await import('../src/auth/url-policy.mjs');
  assert.notEqual(sessionStorageKey('http://localhost:3010'),sessionStorageKey('https://api.example.com'));
  assert.equal(sessionStorageKey('https://api.example.com'),sessionStorageKey('https://api.example.com/'));
  assert.match(sessionStorageKey('https://api.example.com'),/^[A-Za-z0-9._-]+$/);
});
