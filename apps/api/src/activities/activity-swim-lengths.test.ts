import { describe, expect, it } from 'vitest';
import { parseSwimLengths, unavailableSwimLengths } from './activity-swim-lengths.js';
const field = (name: string, value: unknown, units: string | null = null) => ({ name, value, units });
const session = (...extra: unknown[]) => ({ message: 'session', fields: [
  field('pool_length',25,'m'),field('num_lengths',3,'lengths'),field('num_active_lengths',2,'lengths'),...extra]});
const length = (...fields: unknown[]) => ({ message: 'length', fields });
const active = (seconds: number, strokes: number) => length(
  field('length_type','active'),field('total_timer_time',seconds,'s'),field('total_strokes',strokes,'strokes'),field('swim_stroke','freestyle'));
describe('Garmin FIT pool length evidence', () => {
  it('reports active 25 m splits, rests, 100 m pace and computed SWOLF without making up laps', () => {
    const r = parseSwimLengths(session(),
      [active(20,17),length(field('length_type','idle'),field('total_elapsed_time',10,'s')),active(25,18)]);
    expect(r).toMatchObject({status:'available',poolLengthM:25,poolLengthDisplay:'25 m',complete:true,expectedActiveLengths:2});
    expect(r.lengths).toEqual([
      {row:1,lengthNumber:1,kind:'active',durationS:20,durationBasis:'timer',paceSPer100M:80,strokes:17,swolf:37,stroke:'freestyle'},
      {row:2,lengthNumber:null,kind:'rest',durationS:10,durationBasis:'elapsed',paceSPer100M:null,strokes:null,swolf:null,stroke:null},
      {row:3,lengthNumber:2,kind:'active',durationS:25,durationBasis:'timer',paceSPer100M:100,strokes:18,swolf:43,stroke:'freestyle'},
    ]);
  });
  it('does not infer pool size, seconds, strokes or SWOLF from missing and unknown source data', () => {
    const r = parseSwimLengths({message:'session',fields:[field('pool_length',25,'yd')]},[
      length(field('length_type','active'),field('total_elapsed_time',33,'s'),field('total_strokes',null,'strokes')),
      length(field('length_type','strange'),field('total_timer_time',18,'s'))]);
    expect(r.poolLengthM).toBeNull();
    expect(r.lengths[0]).toMatchObject({durationS:33,durationBasis:'elapsed',paceSPer100M:null,strokes:null,swolf:null});
    expect(r.lengths[1]).toMatchObject({kind:'unknown',lengthNumber:null,paceSPer100M:null,swolf:null});
  });
  it('marks truncated or inconsistent evidence incomplete instead of calling it complete', () => {
    const single = parseSwimLengths(session(),[active(20,17)]);
    expect(single.complete).toBe(false);
    expect(parseSwimLengths(session(),[active(20,17)],true).truncated).toBe(true);
    expect(parseSwimLengths(session(),[])).toEqual(unavailableSwimLengths('no_length_messages'));
    expect(parseSwimLengths(null,[active(20,17)])).toEqual(unavailableSwimLengths('missing_session'));
  });
  it('requires agreement with both session counts and classifies unknown lengths as incomplete', () => {
    const wrongActiveCount = [active(20,17),length(field('length_type','idle')),length(field('length_type','idle'))];
    expect(parseSwimLengths(session(),wrongActiveCount).complete).toBe(false);
    expect(parseSwimLengths(session(),[active(20,17),active(25,18),length(field('length_type','unknown'))]).complete).toBe(false);
    expect(parseSwimLengths({message:'session',fields:[]},[active(20,17)]).complete).toBeNull();
  });
  it('accepts the locally verified decoder shape with synthetic fractional timings and native strokes', () => {
    // Field names/units/decoder metadata verified locally; values are invented.
    // Never copy personal FIT records, timestamps or device identifiers here.
    const native = (name:string,value:unknown,units:string|null=null) =>
      ({name,value,units,definition:0,developerIndex:null,rawValue:value});
    const r = parseSwimLengths({message:'session',fields:[native('pool_length',25,'m'),
      native('pool_length_unit','metric'),native('num_lengths',2,'lengths'),native('num_active_lengths',2,'lengths')]},
      [23.625,28.125].map((seconds,i)=>({message:'length',fields:[
        native('length_type','active'),native('total_timer_time',seconds,'s'),native('total_elapsed_time',seconds,'s'),
        native('total_strokes',12+i,'strokes'),native('swim_stroke','freestyle','swim_stroke')]})));
    expect(r).toMatchObject({complete:true,poolLengthM:25});
    expect(r.lengths.map(row=>[row.durationS,row.paceSPer100M,row.strokes,row.swolf,row.stroke]))
      .toEqual([[23.625,94.5,12,35.625,'freestyle'],[28.125,112.5,13,41.125,'freestyle']]);
  });
  it('keeps decoded pool metres even when the display preference is yards', () => {
    const r = parseSwimLengths({message:'session',fields:[field('pool_length',22.86,'m'),field('pool_length_unit','statute')]},[active(30,15)]);
    expect(r.poolLengthM).toBe(22.86);
    expect(r.lengths[0]?.paceSPer100M).toBeCloseTo(131.2336);
  });
  it('rejects conflicting native fields and does not use developer fields or invalid units', () => {
    const r = parseSwimLengths(session(),[length(field('length_type','active'),
      field('total_timer_time',20,'s'),field('total_timer_time',30,'s'),
      {...field('total_elapsed_time',21,'s'),developerIndex:0},field('total_strokes',15,'counts'))]);
    expect(r.lengths[0]).toMatchObject({durationS:null,strokes:null,paceSPer100M:null,swolf:null});
    expect(parseSwimLengths(session(),[active(0,12)]).lengths[0]?.swolf).toBeNull();
  });
});
