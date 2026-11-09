const connectObject=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
import {unavailableSwimLengths,type SwimLengths,type SwimLength} from './swim-lengths.js';
/** Native splits parity established for 25m pools, including omitted/null idle
 * rows. Unverified pool units, missing/repeated rows or inconsistent totals fail
 * closed. Original DTOs retain lap grouping and fields absent from this view. */
export function parseConnectSwimLengths(summary:unknown,splits:unknown):SwimLengths {
 const s=connectObject(summary),laps=connectObject(splits).lapDTOs;
 if(s.poolLength!==25 || connectObject(s.unitOfPoolLength).unitKey!=='meter')return unavailableSwimLengths('unverified_json_pool_units');
 if(!Array.isArray(laps)||!laps.length||laps.length>100)return unavailableSwimLengths('incomplete_json_lengths');
 const rows:SwimLength[]=[];let active=0,total=0;
 const numeric=(v:unknown,max=86400)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max?v:null;
 for(const [lapIndex,lap] of laps.entries()){
  const l=connectObject(lap),lengths=l.lengthDTOs;
  if(!Array.isArray(lengths)||!lengths.length)return unavailableSwimLengths('incomplete_json_lengths');
  let lapDuration=0;
  for(const raw of lengths){
   const row=connectObject(raw),duration=numeric(row.duration);
   if(duration===null||duration<=0||row.lengthIndex!==rows.length+1||rows.length>=2000)return unavailableSwimLengths('incomplete_json_lengths');
   const isActive=row.distance===25;
   if(!isActive&&!['distance','swimStroke','totalNumberOfStrokes'].every(key=>row[key]===null||row[key]===undefined))return unavailableSwimLengths('unverified_json_length_type');
   if(isActive)active++;
   const count=numeric(row.totalNumberOfStrokes,10000),strokes=isActive&&count!==null&&Number.isInteger(count)?count:null;
   const stroke=typeof row.swimStroke==='string'&&/^[A-Z_]{1,32}$/.test(row.swimStroke)?row.swimStroke.toLowerCase().replaceAll('_',' '):null;
   rows.push({row:rows.length+1,lengthNumber:isActive?active:null,lapNumber:lapIndex+1,kind:isActive?'active':'rest',durationS:duration,durationBasis:'timer',paceSPer100M:isActive?duration*4:null,strokes,swolf:isActive&&strokes!==null?duration+strokes:null,stroke});
   lapDuration+=duration;total+=duration;
  }
  const duration=numeric(l.duration,604800);
  if(duration===null||Math.abs(lapDuration-duration)>.1)return unavailableSwimLengths('incomplete_json_lengths');
 }
 const duration=numeric(s.duration,604800);
 if(s.numberOfActiveLengths!==active||duration===null||Math.abs(total-duration)>.1)return unavailableSwimLengths('incomplete_json_lengths');
 return {status:'available',sourceKind:'json',poolLengthM:25,poolLengthDisplay:'25 m',expectedLengths:rows.length,expectedActiveLengths:active,complete:true,truncated:false,lengths:rows};
}
