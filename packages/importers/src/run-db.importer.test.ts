import XLSX from 'xlsx';
import {describe,it,expect} from 'vitest';
import {readWorkbookBuffer,withPhysicalWorkbookRows} from './xlsx-reader.js';
import {parseRunDbWorkbook} from './run-db.importer.js';
const date=46000,time=1200/86400,half=6000/86400;
function workbook(sheets:Record<string,unknown[][]>){const book=XLSX.utils.book_new();for(const[name,rows]of Object.entries(sheets))XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),name);return readWorkbookBuffer(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),'synthetic-records.xlsx');}
describe('verified Google running-record export layouts',()=>{
 it('recognizes the sanitized half tab only from explicit matching distance evidence and links duplicate views',()=>{
  const source=workbook({'5k(sorted':[[],[time,date,null,'*','t']], '10k(sorted)':[[time*2,date]],'12':[[half,date]],M:[[half*2,date]],
   'Лист11':[[time,date,'t']],'Лист12':[[time*2,date]],'Лист13':[[time*2,date]],
   'Лист14':[[5,time,date],[10,time*2,date],[21.1,half,date],[42.2,half*2,date]]});
  const result=parseRunDbWorkbook(source);
  expect(result.events.map(e=>e.distanceM).sort((a,b)=>a-b)).toEqual([5000,10000,21100,42195]);
  expect(result.duplicateRows).toHaveLength(7);expect(result.warnings).toEqual([]);
  expect(result.events.find(e=>e.distanceM===5000)).toMatchObject({durationS:1200,isTreadmill:true,isPrMarker:true,rawPayloadJson:{rowIndex:2}});
  expect(result.duplicateRows.find(r=>r.sheetName==='Лист11')).toMatchObject({originalSheetName:'5k(sorted',originalRowIndex:2});
 });
 it('preserves genuine 12 km input and fails closed on unconfirmed mirror sheets',()=>{
  const result=parseRunDbWorkbook(workbook({'12':[[half,date]],'Лист14':[[21.1,half+1/86400,date]],'Лист12':[[time,date]]}));
  expect(result.events.map(e=>e.distanceM)).toEqual([12000,21100]);expect(result.warnings).toContain("Skipped performance sheet 'Лист12' because distance mapping is not confirmed.");
 });
 it('does not turn distance/time/date columns into huge durations on 1899 dates',()=>{
  const result=parseRunDbWorkbook(workbook({'Лист14':[[5,time,date],[10,time*2,date],[21.1,half,date],[42.2,half*2,date],[7,time,date],[21.1,half,0]]}));
  expect(result.events.map(e=>[e.distanceM,e.durationS])).toEqual([[5000,1200],[10000,2400],[21100,6000]]);
  expect(result.events.every(e=>e.eventDate>'1970-01-01')).toBe(true);expect(result.warnings).toHaveLength(3);
 });
 it('keeps distinct helper evidence and independent identical rows within a primary sheet',()=>{
  const result=parseRunDbWorkbook(workbook({'5k(sorted':[[time,date],[time,date]],'Лист11':[[time,date],[time+1/86400,date]]}));
  expect(result.events).toHaveLength(3);expect(result.duplicateRows).toHaveLength(0);expect(result.warnings[0]).toContain('ambiguous');
 });
 it('retains physical row provenance while preserving previous nonblank hash identities',()=>{
  const source=workbook({'5k(sorted':[[],[time,date],[],[time*2,date+1]]}),physical=withPhysicalWorkbookRows(source);
  expect(physical.rows.map(r=>r.rowIndex)).toEqual([2,4]);expect(physical.rows.map(r=>r.hash)).toEqual(source.rows.map(r=>r.hash));
  expect(parseRunDbWorkbook(source).events.map(e=>e.rawPayloadJson?.rowIndex)).toEqual([2,4]);
 });
 it('rejects invalid numeric date/time semantics rather than guessing',()=>{
  const result=parseRunDbWorkbook(workbook({'5k(sorted':[[5,date],[time,.5],[time,date+.5],[0,date],[time,date]]}));
  expect(result.events).toHaveLength(1);expect(result.warnings).toHaveLength(4);
 });
});
