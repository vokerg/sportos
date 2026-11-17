/** Only for the disposable loopback regression harness; never loads .env. */
import assert from 'node:assert/strict';
import {createDb, sql, WorkerDispatchRepository} from '../packages/db/dist/index.js';
import {createWorkerPass} from '../apps/worker/dist/worker-pass.js';

export async function verifyIdleWorker({dispatchUrl, dataUrl, adminUrl}) {
  for (const value of [dispatchUrl, dataUrl, adminUrl]) {
    if (new URL(value).hostname !== '127.0.0.1') throw new Error('Disposable loopback databases required.');
  }
  const dispatch = createDb(dispatchUrl), admin = createDb(adminUrl);
  try {
    await new WorkerDispatchRepository(dispatch).nextWakeAt(['import_jobs','scoring_rule_changes','provider_sync_jobs','garmin_jobs','daily_recalculation_jobs']);
  } finally { await dispatch.destroy(); }
  try {
    const pass = createWorkerPass({dispatchUrl,dataUrl,storage:{},workerId:'synthetic-idle-smoke',importsEnabled:false,concurrency:1,leaseSeconds:60,provider:null});
    for (let i=0;i<2;i++) {
      await pass(new AbortController().signal);
      const result = await sql`select count(*)::int as clients from pg_stat_activity
        where datname = current_database() and usename in ('sportos_worker','sportos_worker_data')`.execute(admin);
      assert.equal(result.rows[0].clients,0,'Runtime connections must be released after every idle pass.');
    }
    console.log('Two real worker passes released all runtime connections; all five queue deadlines are readable by the dispatcher.');
  } finally { await admin.destroy(); }
}
