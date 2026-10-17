import XLSX from 'xlsx';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {createDb,withAccountContext,ImportsRepository,type Database,type Kysely} from '@sportos/db';
import {ImportService} from './import-service.js';
import {readWorkbookBuffer,withPhysicalWorkbookRows} from './xlsx-reader.js';
const url=process.env.SPORTOS_OWNER_TEST_DATABASE_URL;
(url?describe:describe.skip)('running record import owner-scoped provenance and replay',()=>{
 let db:Kysely<Database>,owner:string;
 const scope=<T>(fn:(d:Kysely<Database>)=>Promise<T>)=>withAccountContext(db,owner,fn);
 function extract(){const book=XLSX.utils.book_new();for(const[name,rows]of Object.entries({'5k(sorted':[[],[1200/86400,46000]],'Лист11':[[1200/86400,46000]],'Лист14':[[5,1200/86400,46000]]}))XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),name);return readWorkbookBuffer(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),'synthetic-records.xlsx');}
 beforeAll(async()=>{db=createDb(url);owner=(await db.insertInto('accounts').values({display_name:'Synthetic record import',email:null,status:'active'}).returning('id').executeTakeFirstOrThrow()).id;});
 afterAll(async()=>{await db?.destroy();});
 it('retains every original row, links mirror provenance and converges without scores or canonical activity writes',async()=>{
  const source=extract();
  for(let i=0;i<2;i++){
   const result=await scope(d=>new ImportService(d).importWorkbook({workbookKind:'run_db',extract:source}));
   expect(result).toMatchObject({performanceEvents:1,activities:0,dailyRows:0,warnings:[]});
  }
  const events=await scope(d=>d.selectFrom('performance_events').selectAll().execute());expect(events).toHaveLength(1);expect(events[0].duration_s).toBe(1200);
  const sources=await scope(d=>d.selectFrom('source_records').selectAll().execute());expect(sources).toHaveLength(6);
  expect(sources.every(s=>s.normalized_entity_id===events[0].id&&s.status==='normalized')).toBe(true);
  expect(sources.filter(s=>s.sheet_name==='5k(sorted').every(s=>s.row_index===2)).toBe(true);
  for(const table of ['activities','daily_metrics','score_ledger','daily_score_snapshots'] as const)expect(await scope(d=>d.selectFrom(table).selectAll().execute())).toHaveLength(0);
 });
 it('bulk provenance linking remains owner scoped',async()=>{
  const source=await scope(d=>d.selectFrom('source_records').selectAll().executeTakeFirstOrThrow());
  const foreign=(await db.insertInto('accounts').values({display_name:'Synthetic record isolation',email:null,status:'active'}).returning('id').executeTakeFirstOrThrow()).id;
  await withAccountContext(db,foreign,d=>new ImportsRepository(d).linkNormalizedRecords([{sourceRecordId:source.id,entityType:'activity',entityId:'00000000-0000-4000-8000-000000000001'}]));
  expect(await scope(d=>d.selectFrom('source_records').selectAll().where('id','=',source.id).executeTakeFirstOrThrow())).toEqual(source);
 });
 it('refuses to silently reinterpret an existing source identity after a parser correction',async()=>{
  const physical=withPhysicalWorkbookRows(extract()),row=physical.rows.find(r=>r.sheetName==='5k(sorted')!;
  await scope(d=>d.updateTable('performance_events').set({duration_s:1250}).where('source_record_hash','=',row.hash).execute());
  await expect(scope(d=>new ImportService(d).importWorkbook({workbookKind:'run_db',extract:extract()}))).rejects.toThrow('RUN_RECORD_NORMALIZATION_CONFLICT');
  expect((await scope(d=>d.selectFrom('performance_events').selectAll().execute()))[0].duration_s).toBe(1250);
  expect(await scope(d=>d.selectFrom('source_records').selectAll().execute())).toHaveLength(6);
 });
});
