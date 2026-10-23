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
});
