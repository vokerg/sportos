import { expect, it } from 'vitest';
import { isDatabaseConnectionError } from './connection-errors.js';

it('recognizes transport, PostgreSQL connection and uncoded pg lifecycle failures', () => {
  for (const code of ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', '08006', '57P01', '57P03']) {
    expect(isDatabaseConnectionError(Object.assign(new Error('private'), { code }))).toBe(true);
  }
  expect(isDatabaseConnectionError(new Error('Connection terminated unexpectedly'))).toBe(true);
  expect(isDatabaseConnectionError(new Error('timeout exceeded when trying to connect'))).toBe(true);
});
it('does not retry unrelated SQL, authentication, saturation or programming failures', () => {
  for (const code of ['42601', '23505', '42501', '28P01', '53300']) {
    expect(isDatabaseConnectionError(Object.assign(new Error('SQL error'), { code }))).toBe(false);
  }
  for (const error of [null, 'ETIMEDOUT', new Error('bug'), new Error('private ETIMEDOUT query')]) {
    expect(isDatabaseConnectionError(error)).toBe(false);
  }
});
