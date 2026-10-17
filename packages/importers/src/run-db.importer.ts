import { buildPerformanceEvent, inferDistanceFromSheetName } from '@sportos/domain';
import { excelSerialDateToIsoDate, excelTimeFractionToSeconds } from '@sportos/shared';
import type { PerformanceEventInput } from '@sportos/shared';
import { asNumber, asString, withPhysicalWorkbookRows, type WorkbookExtract, type WorkbookRow } from './xlsx-reader.js';

// Legacy standalone sheet mappings. Google can sanitize 1/2 to 12 on XLSX
// export; only a complete match to explicitly distance-labelled evidence changes
// that ambiguous sheet to half marathon. A real standalone 12 km sheet stays 12 km.
export const RUN_DB_SHEET_DISTANCE_M: Record<string, number | null> = {
  '5k(sorted':5000,'10k(sorted)':10000,'12':12000,'1/2':21100,
  'Лист14':21100,'M':42195,'Лист11':5000,'Лист13':10000,'Лист12':null,
};
export const RUN_RECORD_PARSER_VERSION = 2;
export interface RunDbDuplicateRow {
  sheetName:string; rowIndex:number; originalSheetName:string; originalRowIndex:number;
}
export interface RunDbImportResult {
  events:PerformanceEventInput[]; warnings:string[]; duplicateRows:RunDbDuplicateRow[];
}
const mirrorSheets=new Set(['Лист11','Лист12','Лист13','Лист14']);
const priority=['5k(sorted','10k(sorted)','1/2','12','M','Лист11','Лист13','Лист12','Лист14'];
export function parseRunDbWorkbook(input:WorkbookExtract):RunDbImportResult {
  const extract=withPhysicalWorkbookRows(input),events:PerformanceEventInput[]=[],warnings:string[]=[],duplicateRows:RunDbDuplicateRow[]=[];
  const sheetRows=(name:string)=>extract.rows.filter(r=>r.sheetName===name);
  const mixed=sheetRows('Лист14').filter(r=>isTime(r.cells[1])&&isDate(r.cells[2]));
  const halfKeys=new Set(mixed.filter(r=>asNumber(r.cells[0])===21.1).map(r=>timeDateKey(r.cells[1],r.cells[2])));
  const ambiguousHalf=sheetRows('12').filter(r=>isTime(r.cells[0])&&isDate(r.cells[1]));
  const confirmedHalf=ambiguousHalf.length>0&&ambiguousHalf.every(r=>halfKeys.has(timeDateKey(r.cells[0],r.cells[1])));
  const tenKeys=new Set(sheetRows('10k(sorted)').filter(r=>isTime(r.cells[0])&&isDate(r.cells[1])).map(r=>timeDateKey(r.cells[0],r.cells[1])));
  const tenMirror=sheetRows('Лист12').filter(r=>isTime(r.cells[0])&&isDate(r.cells[1]));
  const confirmedTenMirror=tenMirror.length>0&&tenMirror.every(r=>tenKeys.has(timeDateKey(r.cells[0],r.cells[1])));
  const marathonKeys=new Set(sheetRows('M').filter(r=>isTime(r.cells[0])&&isDate(r.cells[1])).map(r=>timeDateKey(r.cells[0],r.cells[1])));
  const occurrences=new Map<string,PerformanceEventInput[]>();
  const ordered=[...extract.sheetNames].sort((a,b)=>(priority.indexOf(a)<0?100:priority.indexOf(a))-(priority.indexOf(b)<0?100:priority.indexOf(b)));
  for(const sheetName of ordered){
    const explicitMixed=sheetName==='Лист14'&&mixed.length>0;
    const mapped=sheetName==='12'&&confirmedHalf?21100:sheetName==='Лист12'&&confirmedTenMirror?10000:RUN_DB_SHEET_DISTANCE_M[sheetName]??inferDistanceFromSheetName(sheetName);
    if(!mapped&&!explicitMixed){warnings.push(`Skipped performance sheet '${sheetName}' because distance mapping is not confirmed.`);continue;}
    for(const row of sheetRows(sheetName)){
      const cells=row.cells;
      if(isHeaderRow(row))continue;
      const shift=explicitMixed?1:0;
      if(!isTime(cells[shift])||!isDate(cells[shift+1])){warnings.push(`Skipped performance row '${sheetName}'!${row.rowIndex} because time or date is missing or invalid.`);continue;}
      let distanceM=mapped;
      if(explicitMixed){
        const km=asNumber(cells[0]);
        distanceM=km===5?5000:km===10?10000:km===21.1?21100:km===42.195?42195:
          km===42.2&&marathonKeys.has(timeDateKey(cells[1],cells[2]))?42195:null;
      }
      if(!distanceM){warnings.push(`Skipped performance row '${sheetName}'!${row.rowIndex} because distance mapping is not confirmed.`);continue;}
      const durationS=excelTimeFractionToSeconds(asNumber(cells[shift])!),eventDate=excelSerialDateToIsoDate(asNumber(cells[shift+1])!);
      const markers=cells.slice(shift+2,shift+10).map(asString).filter(Boolean).map(String);
      const isTreadmill=markers.some(m=>m.toLowerCase()==='t'),isPrMarker=markers.includes('*');
      const sourceRank=inferSourceRank(cells.slice(shift+2,shift+10));
      const tags=[sheetName,...markers.filter(m=>!['*','t'].includes(m.toLowerCase()))];
      if(isTreadmill)tags.push('treadmill');if(isPrMarker)tags.push('starred');
      const built=buildPerformanceEvent({eventDate,distanceM,durationS,isTreadmill,isRace:false,isPrMarker,sourceRank,tags,
        rawPayloadJson:{sheetName,rowIndex:row.rowIndex,cells}});
      const event:PerformanceEventInput={...built,source:'run_db_xlsx',isTreadmill,isRace:false,isPrMarker,tags,rawPayloadJson:built.rawPayloadJson??{}};
      const key=`${distanceM}|${eventDate}|${durationS}`,existing=occurrences.get(key)??[];
      if(mirrorSheets.has(sheetName)&&existing.length){
        if(existing.length===1){const original=existing[0].rawPayloadJson;duplicateRows.push({sheetName,rowIndex:row.rowIndex,originalSheetName:String(original?.sheetName),originalRowIndex:Number(original?.rowIndex)});}
        else warnings.push(`Skipped duplicate view row '${sheetName}'!${row.rowIndex} because original achievement identity is ambiguous.`);
        continue;
      }
      events.push(event);occurrences.set(key,[...existing,event]);
    }
  }
  events.sort((a,b)=>extract.sheetNames.indexOf(String(a.rawPayloadJson?.sheetName))-extract.sheetNames.indexOf(String(b.rawPayloadJson?.sheetName))||Number(a.rawPayloadJson?.rowIndex)-Number(b.rawPayloadJson?.rowIndex));
  return {events,warnings,duplicateRows};
}
function isTime(value:unknown){const n=asNumber(value);return n!==undefined&&n>0&&n<1;}
function isDate(value:unknown){const n=asNumber(value);return n!==undefined&&Number.isInteger(n)&&n>=25569&&n<=73050;}
function timeDateKey(time:unknown,date:unknown){return `${excelTimeFractionToSeconds(asNumber(time)!)}|${excelSerialDateToIsoDate(asNumber(date)!)}`;}
function inferSourceRank(values:unknown[]):number|undefined{const numbers=values.map(asNumber).filter((n):n is number=>n!==undefined&&Number.isInteger(n)&&n>0&&n<1000);return numbers.at(-1);}
function isHeaderRow(row:WorkbookRow){return row.rowIndex===1&&(asString(row.cells[0])?.toLowerCase().includes('time')===true||asString(row.cells[1])?.toLowerCase().includes('date')===true);}
