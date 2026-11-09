import {describe,expect,it} from 'vitest';
import {parseConnectSwimLengths,parseSwimLengths} from './index.js';
// Sanitized real-device response SHAPES (four paired activities). Values are
// synthetic, with identifiers/narrative/coordinates/timestamps removed.
const summary=()=>({poolLength:25,unitOfPoolLength:{unitKey:'meter',factor:100},numberOfActiveLengths:2,duration:90});
const splits=()=>({lapDTOs:[{duration:90,lengthDTOs:[
 {lengthIndex:1,distance:25,duration:30,totalNumberOfStrokes:15,swimStroke:'FREESTYLE'},
 {lengthIndex:2,distance:null,duration:20,totalNumberOfStrokes:null,swimStroke:null},
 {lengthIndex:3,distance:25,duration:40,totalNumberOfStrokes:20,swimStroke:'BREASTSTROKE'},
]}]});
const field=(name:string,value:unknown,units:string|null=null)=>({name,value,units});
describe('native pool length parity gates',()=>{
 it('preserves every active and idle row, seconds, strokes, style, SWOLF and lap grouping independently of corrected distance',()=>{
  const parsed=parseConnectSwimLengths(summary(),splits());
  const fit=parseSwimLengths({message:'session',fields:[field('pool_length',25,'m'),field('num_lengths',3,'lengths'),field('num_active_lengths',2,'lengths')]},[
   {message:'length',fields:[field('length_type','active'),field('total_timer_time',30,'s'),field('total_strokes',15,'strokes'),field('swim_stroke','freestyle')]},
   {message:'length',fields:[field('length_type','idle'),field('total_timer_time',20,'s')]},
   {message:'length',fields:[field('length_type','active'),field('total_timer_time',40,'s'),field('total_strokes',20,'strokes'),field('swim_stroke','breaststroke')]},
  ]);
  expect(parsed.complete).toBe(true);expect(parsed.sourceKind).toBe('json');
  expect(parsed.lengths.map(({lapNumber,...row})=>row)).toEqual(fit.lengths);
  expect(parsed.lengths.map(x=>x.lapNumber)).toEqual([1,1,1]);
  const omitted=splits();for(const key of ['distance','swimStroke','totalNumberOfStrokes'])delete (omitted.lapDTOs[0].lengthDTOs[1] as Record<string,unknown>)[key];
  expect(parseConnectSwimLengths(summary(),omitted).lengths).toEqual(parsed.lengths);
  expect(parseConnectSwimLengths({...summary(),distance:75},splits()).lengths).toEqual(parsed.lengths);
 });
 it('fails closed for missing/duplicate entries, malformed rest markers and milliseconds',()=>{
  for(const mutate of [
   (s:ReturnType<typeof splits>)=>s.lapDTOs[0].lengthDTOs.pop(),
   (s:ReturnType<typeof splits>)=>s.lapDTOs[0].lengthDTOs[1].lengthIndex=1,
   (s:ReturnType<typeof splits>)=>s.lapDTOs[0].lengthDTOs[0].duration=30000,
   (s:ReturnType<typeof splits>)=>s.lapDTOs[0].lengthDTOs[1].distance=10,
  ]){const s=splits();mutate(s);expect(parseConnectSwimLengths(summary(),s).status).toBe('unavailable');}
  expect(parseConnectSwimLengths({...summary(),numberOfActiveLengths:3},splits()).status).toBe('unavailable');
 });
 it('retains conservative fallback for unvalidated 50m and yard pool device semantics',()=>{
  expect(parseConnectSwimLengths({...summary(),poolLength:50},splits()).reason).toBe('unverified_json_pool_units');
  expect(parseConnectSwimLengths({...summary(),unitOfPoolLength:{unitKey:'yard'}},splits()).reason).toBe('unverified_json_pool_units');
 });
});
