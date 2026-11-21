import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { withAccountContext } from '../ownership-context.js';
import { createDb } from '../pool.js';
import { compactImportedScoreSource, importedScoreContributionRows, DynamicsRepository } from './dynamics.repository.js';
import type { Json } from '../schema.js';

// SELECT-only fixtures can also validate the installed server without test writes.
const url = process.env.SPORTOS_DYNAMICS_READ_TEST_DATABASE_URL ?? process.env.SPORTOS_OWNER_TEST_DATABASE_URL;
const databaseDescribe = url ? describe : describe.skip;
databaseDescribe('compact imported score source SQL projection (read only)', () => {
  let db: ReturnType<typeof createDb>;
  beforeAll(() => { db = createDb(url!); });
  afterAll(async () => { await db?.destroy(); });
  it('exposes no daily history without account context or for an unrelated account', async () => {
    expect(await new DynamicsRepository(db).listDailyRows('1900-01-01', '2100-12-31')).toEqual([]);
    expect(await withAccountContext(db, randomUUID(), (owned) => new DynamicsRepository(owned).listDailyRows('1900-01-01', '2100-12-31'))).toEqual([]);
    expect(await new DynamicsRepository(db).listDailyRows('1900-01-01', '2100-12-31')).toEqual([]);
  });
  it('preserves recognized cells, duplicate columns, punctuation, Unicode whitespace, comma numbers and invalid-cell fallback', async () => {
    const fixtures: Json[] = [
      {headers:['Date','Steps','Run to S','Bike to S','SUP to S','raw to s','Swim to S','WOtotal','Pow','All','Narrative'],cells:[46160,1000,2000,2500,100,150,200,45,5,6000,'excluded private fixture']},
      {headers:[' STEPS ','Run   to S','_Bike-to-S_','\uFEFFPow\u00A0','Steps',null,{},[]],cells:['1,5',2,88,3,4,77,77,77]},
      {headers:['\u2003RUN\nTO\tS\u3000','___WOtotal___','raw_to_s','swim_to_s'],cells:[1,2,3,4]},
      {headers:['Steps','Pow'],cells:['not numeric',null]},
      {headers:['Pow','Steps'],cells:[7]},
      {headers:['unrelated'],cells:[9]},
      {headers:'not an array',cells:[]}, null,
    ];
    for (const source of fixtures) {
      const projection = compactImportedScoreSource(sql<Json | null>`${JSON.stringify(source)}::jsonb`);
      const result = await sql<{source: Json | null}>`select ${projection} as source`.execute(db);
      const compact = result.rows[0]!.source;
      const read = (value: Json | null) => {
        try { return importedScoreContributionRows('2026-01-01', 6000, value); }
        catch { return 'unattributed'; }
      };
      // Also compare accepted totals so failures cannot accidentally hide different cells.
      for (const total of [0,7,10,10.5,6000]) {
        const evaluate = (value:Json|null) => {try{return importedScoreContributionRows('2026-01-01',total,value);}catch{return 'unattributed';}};
        expect(evaluate(compact)).toEqual(evaluate(source));
      }
      expect(read(compact)).toEqual(read(source));
      expect(JSON.stringify(compact)).not.toContain('excluded private fixture');
    }
  });
});
