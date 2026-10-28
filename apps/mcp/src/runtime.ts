import { createDb, loadEnvFromNearestFile, assertAccountId } from '@sportos/db';
import { assertRuntimeRole, AthleteReadService } from './service.js';
export async function createRuntime() {
  loadEnvFromNearestFile();
  const account = process.env.SPORTOS_MCP_ACCOUNT_ID;
  if (!account) throw Error('Explicit trusted local account binding required.');
  assertAccountId(account);
  const timezone = process.env.SPORTOS_MCP_TIMEZONE ?? 'Europe/Copenhagen';
  const url = process.env.SPORTOS_MCP_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw Error('Non-owner runtime connection required.');
  const db = createDb(url),
    detail = process.env.SPORTOS_ACTIVITY_DETAIL_DATABASE_URL
      ? createDb(process.env.SPORTOS_ACTIVITY_DETAIL_DATABASE_URL)
      : undefined;
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= Promise.all([db.destroy(), detail?.destroy()]).then(() => undefined));
  try {
    await assertRuntimeRole(db);
    return {
      service: new AthleteReadService(db, account, timezone, () => new Date(), detail),
      close,
    };
  } catch {
    await close();
    throw Error(
      'Read-only athlete runtime could not start. Check local binding and non-owner connections.',
    );
  }
}
