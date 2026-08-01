import { sql, type Kysely } from 'kysely';
import type { Database } from './schema.js';

export const LEGACY_ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';

export async function withAccountContext<T>(
  db: Kysely<Database>,
  accountId: string,
  callback: (scopedDb: Kysely<Database>) => Promise<T>,
): Promise<T> {
  assertAccountId(accountId);
  return db.transaction().execute(async (transaction) => {
    await sql`select set_config('sportos.account_id', ${accountId}, true)`.execute(transaction);
    return callback(transaction);
  });
}

export function assertAccountId(accountId: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(accountId)) {
    throw new TypeError('Account identifier must be a UUID.');
  }
}
